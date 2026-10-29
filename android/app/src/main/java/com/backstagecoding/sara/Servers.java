package com.backstagecoding.sara;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Phase 68: several Sara servers in one app, each with its own sign-in.
 *
 * The list (id, name, address, emoji, last message seen) is kept in the app's private settings.
 * The sign-in of the server in use lives where it always did, in the web view's cookie store. The
 * sign-ins of the other servers are their session cookies, encrypted with a key kept in the
 * Android Keystore (AES-GCM; the key never leaves the Keystore), and only ever sent back to the
 * address they came from. Switching saves the current one, clears the cookie store and puts the
 * other one's back, so nobody is signed out. Removing a server forgets only its sign-in.
 */
final class Servers {
    private Servers() {}

    private static final String KEY_ALIAS = "sara-servers";
    /** How long a put-back sign-in cookie lives in the web view (the server decides the real expiry). */
    private static final int COOKIE_MAX_AGE = 400 * 24 * 3600;

    static final class Profile {
        String id;
        String name;
        boolean named;
        String url;
        String emoji;
        long lastUsed;
        long lastId;

        JSONObject json() throws Exception {
            JSONObject j = new JSONObject().put("id", id).put("name", name).put("url", url).put("lastUsed", lastUsed).put("lastId", lastId);
            if (named) j.put("named", true);
            if (emoji != null) j.put("emoji", emoji);
            return j;
        }

        static Profile from(JSONObject j) {
            Profile p = new Profile();
            p.id = j.optString("id");
            p.url = j.optString("url");
            p.name = j.optString("name", host(p.url));
            p.named = j.optBoolean("named", false);
            p.emoji = j.has("emoji") ? j.optString("emoji") : null;
            p.lastUsed = j.optLong("lastUsed", 0);
            p.lastId = j.optLong("lastId", 0);
            return p;
        }
    }

    static String host(String url) {
        try {
            java.net.URI u = new java.net.URI(url);
            return u.getHost() + (u.getPort() == -1 ? "" : ":" + u.getPort());
        } catch (Exception e) {
            return url;
        }
    }

    private static SharedPreferences prefs(Context c) {
        return Net.prefs(c);
    }

    /**
     * The saved servers. The first time after the update, the one server saved before becomes
     * profile #1 (with its sign-in still in the web view), with nothing for the user to do.
     */
    static synchronized List<Profile> list(Context c) {
        SharedPreferences p = prefs(c);
        List<Profile> out = new ArrayList<>();
        String raw = p.getString("servers", null);
        if (raw == null) {
            String old = p.getString("server", null);
            if (old != null) {
                Profile one = new Profile();
                one.id = "s1";
                one.url = old;
                one.name = p.getString("name", host(old));
                one.lastId = p.getLong("lastId", 0);
                one.lastUsed = System.currentTimeMillis();
                out.add(one);
                save(c, out, "s1");
            }
            return out;
        }
        try {
            JSONArray a = new JSONArray(raw);
            for (int i = 0; i < a.length(); i++) {
                Profile x = Profile.from(a.getJSONObject(i));
                if (!x.id.isEmpty() && !x.url.isEmpty()) out.add(x);
            }
        } catch (Exception ignored) {
            // unreadable: start over (the cookie store still has the current sign-in)
        }
        return out;
    }

    static synchronized void save(Context c, List<Profile> list, String activeId) {
        JSONArray a = new JSONArray();
        try {
            for (Profile x : list) a.put(x.json());
        } catch (Exception ignored) {
            return;
        }
        SharedPreferences.Editor e = prefs(c).edit().putString("servers", a.toString());
        Profile now = find(list, activeId);
        if (now != null) {
            // The rest of the app reads "server", "name" and "lastId" for the one in use.
            e.putString("active", now.id).putString("server", now.url).putString("name", now.name).putLong("lastId", now.lastId);
        } else {
            e.remove("active").remove("server").putLong("lastId", 0);
        }
        e.apply();
    }

    static Profile find(List<Profile> list, String id) {
        if (id == null) return null;
        for (Profile x : list) if (x.id.equals(id)) return x;
        return null;
    }

    /** The server in use (null before the first one is added). */
    static Profile active(Context c) {
        List<Profile> l = list(c);
        Profile p = find(l, prefs(c).getString("active", null));
        return p != null ? p : l.isEmpty() ? null : l.get(0);
    }

    /** The saved server at exactly this address (scheme, host and port), if any. */
    static Profile byOrigin(Context c, String url) {
        for (Profile x : list(c)) if (Net.sameOrigin(x.url, url)) return x;
        return null;
    }

    static String nextId(List<Profile> l) {
        for (int i = 1; ; i++) if (find(l, "s" + i) == null) return "s" + i;
    }

    /** A name no other saved server uses: "Sara", then "Sara (192.168.1.20:7882)". */
    static String uniqueName(List<Profile> l, String wanted, String url, String self) {
        String base = wanted == null || wanted.trim().isEmpty() ? host(url) : wanted.trim();
        if (base.length() > 60) base = base.substring(0, 60);
        if (!taken(l, base, self)) return base;
        String withHost = base + " (" + host(url) + ")";
        if (!taken(l, withHost, self)) return withHost;
        for (int i = 2; ; i++) if (!taken(l, withHost + " " + i, self)) return withHost + " " + i;
    }

    private static boolean taken(List<Profile> l, String name, String self) {
        for (Profile x : l) if (!x.id.equals(self) && x.name.toLowerCase(Locale.ROOT).equals(name.toLowerCase(Locale.ROOT))) return true;
        return false;
    }

    // ---------- switching ----------

    /**
     * Makes `url` the server in use: an existing profile at that address, or a new one. The
     * current server's sign-in is put away (encrypted) first, so it stays signed in.
     */
    static synchronized Profile use(Context c, String url) {
        List<Profile> l = list(c);
        Profile cur = find(l, prefs(c).getString("active", null));
        Profile to = null;
        for (Profile x : l) if (Net.sameOrigin(x.url, url)) to = x;
        if (cur != null && to != null && cur.id.equals(to.id)) return cur;
        if (cur != null) {
            cur.lastId = prefs(c).getLong("lastId", cur.lastId);
            putAway(c, cur);
        }
        if (to == null) {
            to = new Profile();
            to.id = nextId(l);
            to.url = url;
            to.name = uniqueName(l, null, url, to.id);
            l.add(to);
        }
        to.lastUsed = System.currentTimeMillis();
        bringBack(c, to);
        save(c, l, to.id);
        return to;
    }

    static Profile useId(Context c, String id) {
        Profile p = find(list(c), id);
        return p == null ? null : use(c, p.url);
    }

    /** Forgets one server: its put-away sign-in and its entry. Returns the one now in use (or null). */
    static synchronized Profile remove(Context c, String id) {
        List<Profile> l = list(c);
        Profile gone = find(l, id);
        if (gone == null) return active(c);
        boolean wasActive = gone.id.equals(prefs(c).getString("active", null));
        l.remove(gone);
        prefs(c).edit().remove("cookie_" + id).apply();
        if (!wasActive) {
            save(c, l, prefs(c).getString("active", null));
            return active(c);
        }
        // Its sign-in was in the cookie store: clear it, then switch to the most recent other one.
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
        Profile next = null;
        for (Profile x : l) if (next == null || x.lastUsed > next.lastUsed) next = x;
        if (next != null) bringBack(c, next);
        save(c, l, next == null ? null : next.id);
        return next;
    }

    static synchronized void rename(Context c, String id, String name, boolean byUser) {
        List<Profile> l = list(c);
        Profile p = find(l, id);
        if (p == null || name == null || name.trim().isEmpty()) return;
        if (!byUser && p.named) return;
        p.name = uniqueName(l, name, p.url, p.id);
        if (byUser) p.named = true;
        save(c, l, prefs(c).getString("active", null));
    }

    static synchronized void setLastId(Context c, String id, long lastId) {
        List<Profile> l = list(c);
        Profile p = find(l, id);
        if (p == null || lastId <= p.lastId) return;
        p.lastId = lastId;
        String act = prefs(c).getString("active", null);
        if (id.equals(act)) prefs(c).edit().putLong("lastId", lastId).apply();
        save(c, l, act);
    }

    /** {"servers":[{id,name,host,active,emoji}]} for the page (no addresses' sign-ins, ever). */
    static String json(Context c) {
        try {
            Profile a = active(c);
            JSONArray arr = new JSONArray();
            for (Profile x : list(c)) {
                JSONObject j = new JSONObject().put("id", x.id).put("name", x.name).put("host", host(x.url)).put("active", a != null && a.id.equals(x.id));
                if (x.emoji != null) j.put("emoji", x.emoji);
                arr.put(j);
            }
            return new JSONObject().put("servers", arr).toString();
        } catch (Exception e) {
            return "{\"servers\":[]}";
        }
    }

    // ---------- the sign-ins ----------

    /** The Cookie header for a request to `url`: the saved server at that exact address only. */
    static String cookieFor(Context c, String url) {
        Profile p = byOrigin(c, url);
        if (p == null) return null;
        if (p.id.equals(prefs(c).getString("active", null))) return CookieManager.getInstance().getCookie(p.url);
        return decrypt(prefs(c).getString("cookie_" + p.id, null));
    }

    /** Moves the server's cookies from the web view into encrypted storage and clears them there. */
    private static void putAway(Context c, Profile p) {
        CookieManager cm = CookieManager.getInstance();
        String cookie = cm.getCookie(p.url);
        String enc = cookie == null || cookie.isEmpty() ? null : encrypt(cookie);
        SharedPreferences.Editor e = prefs(c).edit();
        if (enc != null) e.putString("cookie_" + p.id, enc);
        else e.remove("cookie_" + p.id);
        e.apply();
        cm.removeAllCookies(null);
        cm.flush();
    }

    /** Puts a server's saved cookies back into the web view (for its own address only). */
    private static void bringBack(Context c, Profile p) {
        String cookie = decrypt(prefs(c).getString("cookie_" + p.id, null));
        prefs(c).edit().remove("cookie_" + p.id).apply();
        if (cookie == null) return;
        CookieManager cm = CookieManager.getInstance();
        boolean https = p.url.startsWith("https://");
        for (String part : cookie.split(";")) {
            String kv = part.trim();
            if (kv.isEmpty() || !kv.contains("=")) continue;
            cm.setCookie(p.url, kv + "; Path=/; Max-Age=" + COOKIE_MAX_AGE + "; HttpOnly; SameSite=Strict" + (https ? "; Secure" : ""));
        }
        cm.flush();
    }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return g.generateKey();
    }

    static String encrypt(String plain) {
        try {
            Cipher ci = Cipher.getInstance("AES/GCM/NoPadding");
            ci.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = ci.getIV();
            byte[] ct = ci.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[1 + iv.length + ct.length];
            out[0] = (byte) iv.length;
            System.arraycopy(iv, 0, out, 1, iv.length);
            System.arraycopy(ct, 0, out, 1 + iv.length, ct.length);
            return Base64.encodeToString(out, Base64.NO_WRAP);
        } catch (Exception e) {
            return null; // never stored in the clear
        }
    }

    static String decrypt(String stored) {
        if (stored == null) return null;
        try {
            byte[] all = Base64.decode(stored, Base64.NO_WRAP);
            int n = all[0];
            Cipher ci = Cipher.getInstance("AES/GCM/NoPadding");
            ci.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, all, 1, n));
            return new String(ci.doFinal(all, 1 + n, all.length - 1 - n), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }
}
