package com.backstagecoding.sara;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

/** "Decline" on her incoming call: tells the server (she sends it as a message instead). */
public class CallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String ring = intent.getStringExtra("ring");
        Notify.endRing(context);
        String server = Net.server(context);
        if (ring == null || server == null) return;
        Context c = context.getApplicationContext();
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                Net.postJson(c, server + "/api/calls/" + Uri.encode(ring) + "/decline", "{}");
            } catch (Exception ignored) {
                // the server marks it missed by itself after the ring time
            }
            pending.finish();
        }).start();
    }
}
