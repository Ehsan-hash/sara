package com.backstagecoding.sara;

import android.Manifest;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

/**
 * Phase 29: place reminders. The phone watches the saved places that have reminders waiting
 * (Android's own proximity alerts, no Google services) and tells the server only "arrived at
 * place N" or "left place N". Where the phone is never leaves it.
 */
public final class Places {
    private Places() {}

    static boolean on(Context c) {
        return Net.prefs(c).getBoolean("places", false);
    }

    static boolean canWatch(Context c) {
        if (c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return false;
        return Build.VERSION.SDK_INT < 29 || c.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private static PendingIntent intent(Context c, int id) {
        Intent i = new Intent(c, Receiver.class).setAction("com.backstagecoding.sara.PLACE." + id).putExtra("place", id);
        // Mutable: Android adds "entering" (true/false) to it when the alert fires.
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        return PendingIntent.getBroadcast(c, 9000 + id, i, flags);
    }

    /** Fetches the places to watch and sets the alerts (in the background). Off: removes them all. */
    static void syncAsync(Context context) {
        Context c = context.getApplicationContext();
        new Thread(() -> sync(c), "sara-places").start();
    }

    static synchronized void sync(Context c) {
        LocationManager lm = c.getSystemService(LocationManager.class);
        if (lm == null) return;
        Set<String> old = Net.prefs(c).getStringSet("placeIds", new HashSet<>());
        Set<String> now = new HashSet<>();
        StringBuilder events = new StringBuilder();
        String server = Net.server(c);
        if (on(c) && canWatch(c) && server != null) {
            try {
                Net.Response r = Net.get(c, server + "/api/places/watch");
                if (r.status != 200) return; // keep what's set; try again later
                JSONArray list = new JSONObject(new String(r.body, StandardCharsets.UTF_8)).getJSONArray("places");
                for (int i = 0; i < list.length(); i++) {
                    JSONObject p = list.getJSONObject(i);
                    int id = p.getInt("id");
                    lm.addProximityAlert(p.getDouble("lat"), p.getDouble("lon"), (float) p.getDouble("radius"), -1, intent(c, id));
                    now.add(String.valueOf(id));
                    events.append(id).append('=').append(p.getJSONArray("events").join(",").replace("\"", "")).append(';');
                }
            } catch (SecurityException e) {
                return;
            } catch (Exception e) {
                return;
            }
        }
        for (String id : old) {
            if (!now.contains(id)) {
                try {
                    lm.removeProximityAlert(intent(c, Integer.parseInt(id)));
                } catch (Exception ignored) {
                    // already gone
                }
            }
        }
        Net.prefs(c).edit().putStringSet("placeIds", now).putString("placeEvents", events.toString()).apply();
    }

    /** Does a reminder wait for this event at this place? (Checked before telling the server.) */
    static boolean wanted(Context c, int id, String event) {
        for (String part : Net.prefs(c).getString("placeEvents", "").split(";")) {
            String[] kv = part.split("=", 2);
            if (kv.length == 2 && kv[0].equals(String.valueOf(id))) return kv[1].contains(event);
        }
        return false;
    }

    /** Proximity alert fired: tell the server "arrived" or "left" (and nothing about where). */
    public static class Receiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            int id = intent.getIntExtra("place", -1);
            if (id < 0 || !on(context)) return;
            String event = intent.getBooleanExtra(LocationManager.KEY_PROXIMITY_ENTERING, false) ? "arrive" : "leave";
            Context c = context.getApplicationContext();
            if (!wanted(c, id, event)) return;
            String server = Net.server(c);
            if (server == null) return;
            PendingResult pending = goAsync();
            new Thread(() -> {
                try {
                    Net.postJson(c, server + "/api/places/" + id + "/event", "{\"event\":\"" + event + "\"}");
                    sync(c); // done reminders drop off the watch list
                } catch (Exception ignored) {
                    // no network: the alert fires again next time
                }
                pending.finish();
            }, "sara-place-event").start();
        }
    }
}
