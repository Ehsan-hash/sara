package com.backstagecoding.sara;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.ClipData;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.CancellationSignal;
import android.os.SystemClock;
import android.util.Base64;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * The app: first a one-screen setup (type your server's address), then the normal Sara web app
 * in a full-screen window, with the microphone, camera and photo picker working.
 */
public class MainActivity extends Activity {
    /** True while the app is on screen (no notification needed then: the chat shows it). */
    static volatile boolean visible;

    /** The demo server (for trying Sara out and for app review). */
    static final String DEMO_SERVER = "https://demo.sara.backstagecoding.com";

    private static final int REQ_PERMS = 1;
    private static final int REQ_FILE = 2;
    private static final int REQ_CALL = 4;
    private static final int REQ_UNLOCK = 5;
    private static final int REQ_PLACES = 6;
    private static final int REQ_PLACES_BG = 7;
    private String pendingPlaceName;
    /** With the app lock on, it locks again after this long in the background. */
    private static final long RELOCK_MS = 30_000;

    private WebView web;
    private FrameLayout root;
    private View lockView;
    private boolean locked;
    private long backgroundAt;
    private String pendingCall;
    private String pendingRing;
    /** Text/photos shared from another app, waiting for the page (JSON for window.saraShare). */
    private String pendingShare;
    private PermissionRequest pendingPermission;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        applySecureFlag();
        if (handlePairLink(getIntent())) return;
        takeShare(getIntent());
        takeRing(getIntent());
        // Phase 68: the saved servers (the one from before 1.8 becomes the first, as it was).
        Servers.list(this);
        // Opened from a notification of another saved server: that one first.
        String from = getIntent() == null ? null : getIntent().getStringExtra("server");
        Servers.Profile cur = Servers.active(this);
        if (from != null && cur != null && !from.equals(cur.id) && Servers.useId(this, from) != null) LiveInbox.restart(this);
        String server = Net.server(this);
        if (server == null) showSetup(null, null);
        else showWeb(server, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (handlePairLink(intent)) return;
        if (takeShare(intent)) return;
        if (takeRing(intent)) {
            deliverRing();
            return;
        }
        String conv = intent.getStringExtra("conv");
        // Phase 68: a notification from another saved server opens that server.
        String from = intent.getStringExtra("server");
        Servers.Profile cur = Servers.active(this);
        if (from != null && cur != null && !from.equals(cur.id)) {
            switchTo(from, intent);
            return;
        }
        if (web != null && conv != null) web.loadUrl(Net.server(this) + "/#c=" + Uri.encode(conv));
    }

    /** Phase 68: shows another saved server; every server keeps its sign-in. */
    private void switchTo(String id, Intent intent) {
        Servers.Profile p = Servers.useId(this, id);
        if (p == null) return;
        LiveInbox.restart(this);
        WidgetProvider.refreshAsync(this);
        Toast.makeText(this, getString(R.string.servers_now, p.name), Toast.LENGTH_SHORT).show();
        showWeb(p.url, intent);
    }

    /**
     * sara://pair?s=<server>&c=<code> (from the pairing page): connects to that server and signs
     * in with the one-time code. Without c (the access QR's sign-in page) it connects and shows
     * that server's sign-in. Always asks first, so a link can't quietly switch servers. Phase 68:
     * another server is added next to the ones already here (nobody is signed out).
     */
    private boolean handlePairLink(Intent intent) {
        Uri u = intent == null ? null : intent.getData();
        if (u == null || !"sara".equals(u.getScheme()) || !"pair".equals(u.getHost())) return false;
        String server = u.getQueryParameter("s");
        String given = u.getQueryParameter("c");
        final String code = given == null || given.trim().isEmpty() ? null : given.trim();
        if (server == null) return false;
        String current = Net.server(this);
        Runnable back = () -> {
            if (web == null && Net.server(this) != null) showWeb(Net.server(this), null);
            else if (web == null) showSetup(null, null);
        };
        final String url = Net.pairOrigin(server);
        if (web == null && current == null) showSetup(null, null);
        if (url == null) {
            // A user name before the host, a path, a query or a fragment: not a plain server address.
            new android.app.AlertDialog.Builder(this)
                    .setTitle("This link can't be used")
                    .setMessage("The pairing link doesn't hold a plain server address, so the app won't open it. Make a new code in Sara on your computer: Settings → Data & health → Devices and sign-in → Add a phone.")
                    .setPositiveButton("OK", (d, w) -> back.run())
                    .setOnCancelListener(d -> back.run())
                    .show();
            return true;
        }
        // Already saved (any of them): sign in there again. A new one: added next to the others.
        boolean adding = current != null && !Net.sameOrigin(current, url) && Servers.byOrigin(this, url) == null;
        android.text.SpannableStringBuilder msg = new android.text.SpannableStringBuilder();
        int start;
        if (adding) {
            String m = getString(R.string.servers_add_message, url);
            msg.append(m);
            start = m.indexOf(url);
            msg.setSpan(new android.text.style.StyleSpan(Typeface.BOLD), start, start + url.length(), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        } else {
            msg.append("Sign in to ");
            start = msg.length();
            msg.append(url);
            msg.setSpan(new android.text.style.StyleSpan(Typeface.BOLD), start, msg.length(), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            msg.append("?");
        }
        if (url.startsWith("http://") && !Net.isPrivateHost(url)) {
            msg.append("\n\n⚠ This address uses plain http on the open internet: anyone on the way could read your messages. Only continue if you set it up that way.");
        }
        if (adding) msg.append("\n\n").append(getString(R.string.servers_add_only_yours));
        boolean switching = adding;
        android.app.AlertDialog.Builder b = new android.app.AlertDialog.Builder(this)
                .setTitle(adding ? getString(R.string.servers_add_title) : code != null ? "Sign in with a code" : "Open your Sara")
                .setMessage(msg)
                .setOnCancelListener(d -> back.run());
        if (adding) {
            // Cancel is the main (default) choice; adding a server from a link is the careful one.
            b.setPositiveButton(getString(R.string.servers_cancel), (d, w) -> back.run());
            b.setNegativeButton(getString(R.string.servers_add), (d, w) -> connect(url, code));
        } else {
            b.setPositiveButton("Sign in", (d, w) -> connect(url, code));
            b.setNegativeButton("Cancel", (d, w) -> back.run());
        }
        android.app.AlertDialog dlg = b.create();
        if (switching) {
            dlg.setOnShowListener(d -> {
                Button sw = dlg.getButton(android.app.AlertDialog.BUTTON_NEGATIVE);
                if (sw != null) sw.setTextColor(Color.parseColor("#E5484D"));
                Button cancel = dlg.getButton(android.app.AlertDialog.BUTTON_POSITIVE);
                if (cancel != null) cancel.requestFocus();
            });
        }
        dlg.show();
        return true;
    }

    /**
     * Opens that server (a saved one, or a new one added to the list); with a pairing code, signs
     * in on the way. The server that was in use stays signed in (Phase 68).
     */
    private void connect(String url, String code) {
        Servers.use(this, url);
        LiveInbox.restart(this);
        Intent i = new Intent();
        if (code != null && !code.trim().isEmpty()) i.putExtra("pair", code.trim());
        showWeb(url, i);
    }

    // ---------- setup ----------

    private void showSetup(String prefill, String error) {
        dropWeb();
        // Phase 68: with a Sara already here, this screen adds another one (Back returns).
        final Servers.Profile here = Servers.active(this);
        int pad = dp(24);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_VERTICAL);
        box.setPadding(pad, pad, pad, pad);
        box.setBackgroundColor(Color.parseColor("#141318"));

        TextView title = text(here != null ? getString(R.string.servers_add_a_sara) : "Connect to your companion", 24, Color.WHITE);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        TextView help = text("Type the address of your Sara server: the same one you open in your browser, for example sara.example.com or 192.168.1.20:7860.", 15, Color.parseColor("#D0CCD8"));
        help.setPadding(0, dp(12), 0, dp(16));

        EditText address = new EditText(this);
        address.setHint("sara.example.com");
        address.setSingleLine(true);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        address.setTextColor(Color.WHITE);
        address.setHintTextColor(Color.parseColor("#7A7484"));
        if (prefill != null) address.setText(prefill);

        EditText pairCode = new EditText(this);
        pairCode.setHint("Pairing code (optional)");
        pairCode.setSingleLine(true);
        pairCode.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        pairCode.setTextColor(Color.WHITE);
        pairCode.setHintTextColor(Color.parseColor("#7A7484"));
        TextView codeHelp = text("Get a code in Sara on your computer: Settings → Devices and sign-in → Add a phone. Without one, you sign in with your owner token.", 13, Color.parseColor("#9A94A4"));
        codeHelp.setPadding(0, dp(4), 0, 0);

        TextView status = text(error == null ? "" : error, 14, Color.parseColor("#FF8A8A"));
        status.setPadding(0, dp(10), 0, dp(10));

        Button go = new Button(this);
        go.setText("Connect");
        Runnable connect = () -> {
            String url = Net.normalize(address.getText().toString());
            if (url.isEmpty()) return;
            go.setEnabled(false);
            status.setTextColor(Color.parseColor("#D0CCD8"));
            status.setText("Checking…");
            // Typed without http:// or https://: try https first, then plain http (a server at home).
            String typed = address.getText().toString().trim();
            boolean schemeGiven = typed.startsWith("http://") || typed.startsWith("https://");
            String[] tries = schemeGiven ? new String[] {url} : new String[] {url, "http://" + url.substring("https://".length())};
            new Thread(() -> {
                String err = "Couldn't reach it. Check the address, and that the server is running.";
                String found = null;
                for (String t : tries) {
                    try {
                        Net.Response r = Net.get(this, t + "/api/health");
                        if (r.status == 200 && r.text().contains("\"ok\"")) {
                            found = t;
                            break;
                        }
                        err = "That address answered, but it isn't a Sara server.";
                    } catch (Exception e) {
                        // try the next one
                    }
                }
                String finalErr = found == null ? err : null;
                String finalUrl = found;
                runOnUiThread(() -> {
                    go.setEnabled(true);
                    if (finalErr != null) {
                        status.setTextColor(Color.parseColor("#FF8A8A"));
                        status.setText(finalErr);
                        return;
                    }
                    connect(finalUrl, pairCode.getText().toString());
                });
            }).start();
        };
        go.setOnClickListener(v -> connect.run());
        address.setOnEditorActionListener((v, id, ev) -> {
            connect.run();
            return true;
        });

        Button demo = new Button(this);
        demo.setText("Try the demo");
        demo.setAllCaps(false);
        demo.setOnClickListener(v -> {
            Servers.use(this, DEMO_SERVER);
            Intent i = new Intent();
            i.putExtra("demo", true);
            showWeb(DEMO_SERVER, i);
        });
        TextView demoHelp = text("No server yet? The demo shows what Sara is like (conversations there aren't saved).", 13, Color.parseColor("#9A94A4"));
        demoHelp.setPadding(0, dp(18), 0, dp(4));

        box.addView(title);
        box.addView(help);
        box.addView(address);
        box.addView(pairCode);
        box.addView(codeHelp);
        box.addView(status);
        box.addView(go);
        box.addView(demoHelp);
        box.addView(demo);
        if (here != null) {
            Button back = new Button(this);
            back.setText(getString(R.string.servers_back, here.name));
            back.setAllCaps(false);
            back.setOnClickListener(v -> showWeb(here.url, null));
            box.addView(back);
        }
        keepClearOfBars(box, pad);
        setContentView(box);
    }

    // ---------- the app ----------

    /** Lets go of the web view (switching servers or showing the setup screen). */
    private void dropWeb() {
        if (web == null) return;
        WebView old = web;
        web = null;
        if (root != null) root.removeView(old);
        old.destroy();
    }

    private void showWeb(String server, Intent intent) {
        dropWeb();
        // Test builds only: lets a developer inspect the page from a computer (chrome://inspect).
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " SaraPhone/1");
        CookieManager.getInstance().setAcceptCookie(true);
        final String host = Uri.parse(server).getHost();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (host != null && host.equals(u.getHost())) return false;
                // Other sites (links, Google sign-in) open in the phone's browser.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                    // no browser
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showSetup(server, "Couldn't open " + server + " (" + err.getDescription() + "). Check your connection, or change the address.");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                deliverShare();
                deliverRing();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                List<String> need = new ArrayList<>();
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && !has(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && !has(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
                }
                if (need.isEmpty()) {
                    request.grant(request.getResources());
                } else {
                    pendingPermission = request;
                    requestPermissions(need.toArray(new String[0]), REQ_PERMS);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "SaraPhone");
        CallService.listener = this::callEvent;
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#121016"));
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        // Android 15+ draws apps edge to edge: keep the page clear of the status bar, the
        // navigation/gesture bar and the keyboard.
        keepClearOfBars(root, 0);
        setContentView(root);
        if (lockOn() && locked) {
            locked = false;
            lock();
        }
        String conv = intent == null ? null : intent.getStringExtra("conv");
        String pair = intent == null ? null : intent.getStringExtra("pair");
        boolean demo = intent != null && intent.getBooleanExtra("demo", false);
        web.loadUrl(server + (pair != null ? "/pair#" + Uri.encode(pair) : demo ? "/?demo=1" : conv != null ? "/#c=" + Uri.encode(conv) : "/"));

        // Notifications: ask once (Android 13+), then check for her messages in the background.
        if (Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.POST_NOTIFICATIONS)) {
            requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 3);
        }
        InboxJob.schedule(this);
    }

    /** Pads a screen so it stays clear of the status bar, gesture bar, cutout and keyboard. */
    private static void keepClearOfBars(View v, int extra) {
        v.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = insets.getInsets(android.view.WindowInsets.Type.ime());
            view.setPadding(bars.left + extra, bars.top + extra, bars.right + extra, Math.max(bars.bottom, ime.bottom) + extra);
            return android.view.WindowInsets.CONSUMED;
        });
    }

    // ---------- Share to her from any app (Phase 18) ----------

    /** Reads text and photos shared from another app; they go into the message box. */
    private boolean takeShare(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return false;
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        CharSequence body = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        String text = body == null ? "" : body.toString();
        if (subject != null && !subject.isEmpty() && !text.contains(subject)) text = text.isEmpty() ? subject : subject + "\n" + text;
        List<Uri> uris = new ArrayList<>();
        ClipData clip = intent.getClipData();
        if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) if (clip.getItemAt(i).getUri() != null) uris.add(clip.getItemAt(i).getUri());
        if (uris.isEmpty()) {
            Uri one = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : legacyStream(intent);
            if (one != null) uris.add(one);
        }
        final String shareText = text;
        new Thread(() -> {
            try {
                JSONArray images = new JSONArray();
                for (Uri u : uris) {
                    if (images.length() >= 4) break;
                    String data = photoDataUrl(u);
                    if (data != null) images.put(data);
                }
                pendingShare = new JSONObject().put("text", shareText).put("images", images).toString();
                runOnUiThread(this::deliverShare);
            } catch (Exception ignored) {
                // nothing usable
            }
        }).start();
        return true;
    }

    @SuppressWarnings("deprecation")
    private static Uri legacyStream(Intent intent) {
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    /** A shared photo, shrunk to at most 2048 px, as a JPEG data URL. */
    private String photoDataUrl(Uri uri) {
        try {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                BitmapFactory.decodeStream(in, null, o);
            }
            if (o.outWidth <= 0) return null;
            int sample = 1;
            while (Math.max(o.outWidth, o.outHeight) / sample > 2048) sample *= 2;
            BitmapFactory.Options o2 = new BitmapFactory.Options();
            o2.inSampleSize = sample;
            Bitmap bmp;
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                bmp = BitmapFactory.decodeStream(in, null, o2);
            }
            if (bmp == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 85, out);
            bmp.recycle();
            return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    // ---------- Phase 26: her call, and "Call Sara" ----------

    /** From her ringing notification (show or answer) or the "Call Sara" shortcut. */
    private boolean takeRing(Intent intent) {
        if (intent == null) return false;
        if ("com.backstagecoding.sara.CALL".equals(intent.getAction())) {
            pendingRing = "window.saraStartCall&&window.saraStartCall()";
            intent.setAction(null);
            return true;
        }
        String action = intent.getStringExtra("ringAction");
        String ring = intent.getStringExtra("ring");
        if (action == null || ring == null) return false;
        intent.removeExtra("ringAction");
        // Over the lock screen, screen on: it's a call.
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        Notify.endRing(this);
        String conv = intent.getStringExtra("ringConv");
        String reason = intent.getStringExtra("ringReason");
        try {
            org.json.JSONObject r = new org.json.JSONObject().put("id", ring).put("conversationId", conv).put("reason", reason == null ? "" : reason).put("state", "ringing");
            pendingRing = "answer".equals(action)
                    ? "window.saraAnswerRing&&window.saraAnswerRing(" + org.json.JSONObject.quote(ring) + "," + org.json.JSONObject.quote(conv) + ")"
                    : "window.saraShowRing&&window.saraShowRing(" + r + ")";
        } catch (Exception e) {
            return false;
        }
        return true;
    }

    private void deliverRing() {
        String js = pendingRing;
        if (js == null || web == null) return;
        pendingRing = null;
        String ready = js.substring(0, js.indexOf("&&"));
        web.evaluateJavascript("(function t(n){if(" + ready + "&&document.querySelector('#main')&&!document.querySelector('#main').hidden)" + js.substring(js.indexOf("&&") + 2) + ";else if(n<240)setTimeout(function(){t(n+1)},250)})(0)", null);
    }

    private void deliverShare() {
        String json = pendingShare;
        if (json == null || web == null) return;
        pendingShare = null;
        web.evaluateJavascript("(function t(n){if(window.saraShare&&document.querySelector('#main')&&!document.querySelector('#main').hidden)window.saraShare(" + json + ");else if(n<240)setTimeout(function(){t(n+1)},250)})(0)", null);
    }

    // ---------- App lock (Phase 18) ----------

    private boolean lockOn() {
        return Net.prefs(this).getBoolean("appLock", false);
    }

    private void applySecureFlag() {
        // Hides the app's content in the recent-apps view while the lock is on.
        if (lockOn()) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    private void lock() {
        if (root == null || locked) return;
        locked = true;
        if (lockView == null) {
            LinearLayout box = new LinearLayout(this);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setGravity(Gravity.CENTER);
            box.setBackgroundColor(Color.parseColor("#121016"));
            box.setClickable(true);
            TextView t = text("🔒", 44, Color.WHITE);
            t.setGravity(Gravity.CENTER);
            TextView m = text("Locked", 20, Color.WHITE);
            m.setGravity(Gravity.CENTER);
            m.setPadding(0, dp(8), 0, dp(20));
            Button b = new Button(this);
            b.setText("Unlock");
            b.setAllCaps(false);
            b.setOnClickListener(v -> askToUnlock());
            box.addView(t);
            box.addView(m);
            box.addView(b);
            lockView = box;
        }
        if (lockView.getParent() == null) root.addView(lockView, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        askToUnlock();
    }

    private void unlock() {
        locked = false;
        if (lockView != null && lockView.getParent() != null) root.removeView(lockView);
    }

    @SuppressWarnings("deprecation")
    private void askToUnlock() {
        KeyguardManager km = getSystemService(KeyguardManager.class);
        if (km == null || !km.isDeviceSecure()) {
            unlock(); // the phone has no screen lock any more: nothing to check against
            return;
        }
        if (Build.VERSION.SDK_INT >= 28) {
            BiometricPrompt.Builder b = new BiometricPrompt.Builder(this).setTitle("Unlock Sara");
            if (Build.VERSION.SDK_INT >= 30) b.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
            else b.setDeviceCredentialAllowed(true);
            b.build().authenticate(new CancellationSignal(), getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    unlock();
                }
            });
        } else {
            Intent i = km.createConfirmDeviceCredentialIntent("Unlock Sara", null);
            if (i != null) startActivityForResult(i, REQ_UNLOCK);
            else unlock();
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        applySecureFlag();
        LiveInbox.sync(this);
        if (lockOn() && (backgroundAt == 0 || SystemClock.elapsedRealtime() - backgroundAt > RELOCK_MS)) lock();
    }

    @Override
    protected void onStop() {
        backgroundAt = SystemClock.elapsedRealtime();
        super.onStop();
    }

    // ---------- Live calls run natively (Phase 18) ----------

    private String pendingCallRing;

    // ---------- Phase 29: place reminders ----------

    /** Location while using the app, then "Allow all the time" (needed to notice arriving later). */
    private void askPlacePermissions() {
        if (!has(Manifest.permission.ACCESS_FINE_LOCATION)) {
            requestPermissions(new String[] {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PLACES);
            return;
        }
        if (Build.VERSION.SDK_INT >= 29 && !has(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
            new android.app.AlertDialog.Builder(this)
                    .setTitle("Allow location all the time?")
                    .setMessage("To remind you when you get somewhere, Sara has to notice you arriving while the app is closed. On the next screen choose \"Allow all the time\". Your location stays on this phone: Sara only tells your server \"arrived at Store\".")
                    .setPositiveButton("Continue", (d, w) -> requestPermissions(new String[] {Manifest.permission.ACCESS_BACKGROUND_LOCATION}, REQ_PLACES_BG))
                    .setNegativeButton("Not now", null)
                    .show();
        }
    }

    private void placeResult(boolean ok, String message) {
        web.evaluateJavascript("window.saraPlaceSaved&&window.saraPlaceSaved(" + ok + "," + org.json.JSONObject.quote(message) + ")", null);
    }

    @SuppressWarnings("deprecation")
    private void locateAndSave(String name) {
        android.location.LocationManager lm = getSystemService(android.location.LocationManager.class);
        if (lm == null) {
            placeResult(false, "This phone has no location service.");
            return;
        }
        String provider = lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER) ? android.location.LocationManager.GPS_PROVIDER
                : lm.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER) ? android.location.LocationManager.NETWORK_PROVIDER : null;
        if (provider == null) {
            placeResult(false, "Location is switched off on this phone. Turn it on in the quick settings and try again.");
            return;
        }
        java.util.function.Consumer<android.location.Location> got = (loc) -> {
            if (loc == null) {
                placeResult(false, "Couldn't find where you are. Try again outside or near a window.");
                return;
            }
            String server = Net.server(this);
            new Thread(() -> {
                try {
                    org.json.JSONObject body = new org.json.JSONObject().put("name", name).put("lat", loc.getLatitude()).put("lon", loc.getLongitude());
                    Net.Response r = Net.postJson(this, server + "/api/places", body.toString());
                    String msg = r.status == 201 ? "Saved: " + name : new org.json.JSONObject(new String(r.body, java.nio.charset.StandardCharsets.UTF_8)).optString("error", "Couldn't save it.");
                    runOnUiThread(() -> placeResult(r.status == 201, msg));
                    Places.sync(this);
                } catch (Exception e) {
                    android.util.Log.w("Sara", "Saving a place failed", e);
                    runOnUiThread(() -> placeResult(false, "Couldn't reach your server."));
                }
            }).start();
        };
        try {
            if (Build.VERSION.SDK_INT >= 30) lm.getCurrentLocation(provider, null, getMainExecutor(), got);
            else lm.requestSingleUpdate(provider, new android.location.LocationListener() {
                @Override
                public void onLocationChanged(android.location.Location l) {
                    got.accept(l);
                }
            }, android.os.Looper.getMainLooper());
        } catch (SecurityException e) {
            placeResult(false, "Sara needs location permission to save a place.");
        }
    }

    private void beginCall(String conv) {
        beginCall(conv, null);
    }

    private void beginCall(String conv, String ring) {
        if (!has(Manifest.permission.RECORD_AUDIO)) {
            pendingCall = conv;
            pendingCallRing = ring;
            requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, REQ_CALL);
            return;
        }
        CallService.start(this, conv, ring);
    }

    private void callEvent(String json) {
        runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript("window.saraCallEvent&&window.saraCallEvent(" + json + ")", null);
        });
    }

    /** What the web app can ask the phone app to do (only Sara's own pages load in this window). */
    final class Bridge {
        /** Asks the home screen to place her widget; false if this launcher can't (then: by hand). */
        @JavascriptInterface
        public boolean addWidget() {
            AppWidgetManager m = getSystemService(AppWidgetManager.class);
            if (m == null || !m.isRequestPinAppWidgetSupported()) return false;
            return m.requestPinAppWidget(new ComponentName(MainActivity.this, WidgetProvider.class), null, null);
        }

        @JavascriptInterface
        public void changeServer() {
            runOnUiThread(() -> showSetup(null, null));
        }

        // ---- Phase 68: several Saras in one app (the page shows the list; sign-ins stay here) ----

        /** {"servers":[{id,name,host,active,emoji}]}: names and hosts only, never a sign-in. */
        @JavascriptInterface
        public String servers() {
            return Servers.json(MainActivity.this);
        }

        @JavascriptInterface
        public void useServer(String id) {
            runOnUiThread(() -> switchTo(id, null));
        }

        @JavascriptInterface
        public void addServer() {
            runOnUiThread(() -> showSetup(null, null));
        }

        /** Forgets that server's sign-in only (signing this phone out there first). */
        @JavascriptInterface
        public void removeServer(String id) {
            Context c = MainActivity.this;
            Servers.Profile p = Servers.find(Servers.list(c), id);
            if (p == null) return;
            new Thread(() -> {
                try {
                    Net.postJson(c, p.url + "/api/logout", "{}");
                } catch (Exception ignored) {
                    // offline: the sign-in is forgotten here anyway
                }
                Servers.Profile was = Servers.active(c);
                boolean wasActive = was != null && was.id.equals(id);
                Servers.Profile now = Servers.remove(c, id);
                runOnUiThread(() -> {
                    if (!wasActive) {
                        if (web != null) web.evaluateJavascript("window.saraServersChanged&&window.saraServersChanged()", null);
                        return;
                    }
                    LiveInbox.restart(c);
                    if (now == null) showSetup(null, null);
                    else showWeb(now.url, null);
                });
            }).start();
        }

        @JavascriptInterface
        public void renameServer(String id, String name) {
            Servers.rename(MainActivity.this, id, name, true);
        }

        /** The page tells the app her name on this server (names the entry until renamed). */
        @JavascriptInterface
        public void serverName(String name) {
            Servers.Profile p = Servers.active(MainActivity.this);
            if (p != null) Servers.rename(MainActivity.this, p.id, name, false);
        }

        /** Settings kept on the phone: instant, lockPrivate, appLock. */
        @JavascriptInterface
        public String getPref(String name) {
            return String.valueOf(Net.prefs(MainActivity.this).getBoolean(name, false));
        }

        @JavascriptInterface
        public boolean setPref(String name, boolean on) {
            Context c = MainActivity.this;
            switch (name) {
                case "instant":
                case "lockPrivate":
                    Net.prefs(c).edit().putBoolean(name, on).apply();
                    if ("instant".equals(name)) runOnUiThread(() -> LiveInbox.sync(c));
                    return true;
                case "places":
                    // Phase 29: place reminders. On asks for location ("while using", then "all the time").
                    Net.prefs(c).edit().putBoolean(name, on).apply();
                    runOnUiThread(() -> {
                        if (on) askPlacePermissions();
                        Places.syncAsync(c);
                    });
                    return true;
                case "appLock":
                    KeyguardManager km = getSystemService(KeyguardManager.class);
                    if (on && (km == null || !km.isDeviceSecure())) {
                        runOnUiThread(() -> Toast.makeText(c, "Set a screen lock in your phone's settings first.", Toast.LENGTH_LONG).show());
                        return false;
                    }
                    Net.prefs(c).edit().putBoolean(name, on).apply();
                    runOnUiThread(MainActivity.this::applySecureFlag);
                    return true;
                default:
                    return false;
            }
        }

        @JavascriptInterface
        public void startCall(String conversationId) {
            runOnUiThread(() -> beginCall(conversationId));
        }

        /** Phase 26: can her calls show full screen on a locked phone? "ok", or "ask" (Android 14+ needs the owner's OK). */
        @JavascriptInterface
        public String fullScreenCalls() {
            if (Build.VERSION.SDK_INT < 34) return "ok";
            android.app.NotificationManager nm = getSystemService(android.app.NotificationManager.class);
            return nm != null && nm.canUseFullScreenIntent() ? "ok" : "ask";
        }

        @JavascriptInterface
        public void openFullScreenSettings() {
            if (Build.VERSION.SDK_INT < 34) return;
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getPackageName())));
                } catch (Exception e) {
                    startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName()));
                }
            });
        }

        /** Phase 29: "off", "need-location", "need-background" (Allow all the time) or "on". */
        @JavascriptInterface
        public String placesStatus() {
            Context c = MainActivity.this;
            if (!Places.on(c)) return "off";
            if (!has(Manifest.permission.ACCESS_FINE_LOCATION)) return "need-location";
            if (!Places.canWatch(c)) return "need-background";
            return "on";
        }

        @JavascriptInterface
        public void fixPlacePermissions() {
            runOnUiThread(MainActivity.this::askPlacePermissions);
        }

        /** Saves the phone's current location as a named place on the server. */
        @JavascriptInterface
        public void savePlaceHere(String name) {
            runOnUiThread(() -> {
                if (!has(Manifest.permission.ACCESS_FINE_LOCATION)) {
                    pendingPlaceName = name;
                    requestPermissions(new String[] {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PLACES);
                    return;
                }
                locateAndSave(name);
            });
        }

        /** Phase 36: saves one of her pictures (from this server only) to the phone's Pictures/Sara. */
        @JavascriptInterface
        public void savePicture(String url, String name) {
            Context c = MainActivity.this;
            String server = Net.server(c);
            if (server == null || !Net.sameOrigin(server, url)) return;
            if (Build.VERSION.SDK_INT < 29) {
                runOnUiThread(() -> Toast.makeText(c, "Saving pictures needs Android 10 or newer.", Toast.LENGTH_LONG).show());
                return;
            }
            String file = (name == null || name.isEmpty() ? "Sara" : name.replaceAll("[^\\w .-]", "")) + ".jpg";
            new Thread(() -> {
                String msg;
                try {
                    Net.Response r = Net.get(c, url);
                    if (r.status != 200 || r.body.length == 0) throw new java.io.IOException("HTTP " + r.status);
                    android.content.ContentValues v = new android.content.ContentValues();
                    v.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, file);
                    v.put(android.provider.MediaStore.Images.Media.MIME_TYPE, r.body.length > 3 && (r.body[0] & 0xff) == 0x89 ? "image/png" : "image/jpeg");
                    v.put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, android.os.Environment.DIRECTORY_PICTURES + "/Sara");
                    Uri out = getContentResolver().insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                    if (out == null) throw new java.io.IOException("no space");
                    try (java.io.OutputStream os = getContentResolver().openOutputStream(out)) {
                        os.write(r.body);
                    }
                    msg = "Saved to Pictures/Sara.";
                } catch (Exception e) {
                    msg = "Couldn't save the picture.";
                }
                String m = msg;
                runOnUiThread(() -> Toast.makeText(c, m, Toast.LENGTH_SHORT).show());
            }).start();
        }

        /** Phase 26: answering her call. */
        @JavascriptInterface
        public void answerCall(String conversationId, String ringId) {
            runOnUiThread(() -> beginCall(conversationId, ringId));
        }

        @JavascriptInterface
        public void hangUp() {
            CallService.hangUp(MainActivity.this);
        }
    }

    private boolean has(String perm) {
        return checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_CALL && pendingCall != null) {
            String conv = pendingCall;
            pendingCall = null;
            String ring = pendingCallRing;
            pendingCallRing = null;
            if (has(Manifest.permission.RECORD_AUDIO)) CallService.start(this, conv, ring);
            else callEvent("{\"type\":\"ended\",\"reason\":\"Microphone: permission denied.\"}");
            return;
        }
        if (code == REQ_PLACES) {
            String name = pendingPlaceName;
            pendingPlaceName = null;
            if (!has(Manifest.permission.ACCESS_FINE_LOCATION)) {
                placeResult(false, "Sara needs location permission to save a place or watch for it.");
                return;
            }
            if (name != null) locateAndSave(name);
            else askPlacePermissions();
            Places.syncAsync(this);
            return;
        }
        if (code == REQ_PLACES_BG) {
            Places.syncAsync(this);
            web.evaluateJavascript("window.saraPlacesChanged&&window.saraPlacesChanged()", null);
            return;
        }
        if (code == REQ_PERMS && pendingPermission != null) {
            List<String> ok = new ArrayList<>();
            for (String r : pendingPermission.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && has(Manifest.permission.RECORD_AUDIO)) ok.add(r);
                else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && has(Manifest.permission.CAMERA)) ok.add(r);
                else if (!PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && !PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) ok.add(r);
            }
            if (ok.isEmpty()) pendingPermission.deny();
            else pendingPermission.grant(ok.toArray(new String[0]));
            pendingPermission = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_UNLOCK) {
            if (result == RESULT_OK) unlock();
            return;
        }
        if (code == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(code, result, data);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        if (Places.on(this)) Places.syncAsync(this);
    }

    @Override
    protected void onDestroy() {
        if (CallService.listener != null) CallService.listener = null;
        super.onDestroy();
    }

    @Override
    protected void onPause() {
        visible = false;
        CookieManager.getInstance().flush();
        WidgetProvider.refreshAsync(this);
        super.onPause();
    }

    private TextView text(String s, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        return t;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
