package com.backstagecoding.sara;

import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import org.json.JSONObject;

/** "Reply" typed into a notification: sends it; her answer comes back as a notification. */
public class ReplyReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        CharSequence text = results == null ? null : results.getCharSequence(Notify.KEY_REPLY);
        String conv = intent.getStringExtra("conv");
        int id = intent.getIntExtra("id", 0);
        String name = intent.getStringExtra("name");
        String server = Net.server(context);
        if (text == null || text.toString().trim().isEmpty() || conv == null || server == null) return;
        Context c = context.getApplicationContext();
        PendingResult pending = goAsync();
        new Thread(() -> {
            String problem = null;
            try {
                JSONObject body = new JSONObject().put("content", text.toString()).put("background", true);
                Net.Response r = Net.postJson(c, server + "/api/conversations/" + Uri.encode(conv) + "/messages", body.toString());
                if (r.status == 409) problem = "She's still answering. Open the app to see.";
                else if (r.status == 401) problem = "Open the app and sign in again.";
                else if (r.status != 202) problem = "Couldn't send. Open the app to try again.";
            } catch (Exception e) {
                problem = "Couldn't reach your server.";
            }
            Notify.replied(c, id, name == null ? "Sara" : name, text, problem);
            pending.finish();
        }).start();
    }
}
