package com.backstagecoding.sara;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** Home-screen widget: her face (for her current mood), her mood, and her last message. */
public class WidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        final PendingResult done = goAsync();
        new Thread(() -> {
            try {
                refresh(context.getApplicationContext());
            } finally {
                done.finish();
            }
        }).start();
    }

    static void refreshAsync(Context context) {
        Context app = context.getApplicationContext();
        new Thread(() -> refresh(app)).start();
    }

    /** Fetches the widget's data and redraws every placed widget. Safe to call from any thread. */
    static void refresh(Context c) {
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        int[] ids = manager.getAppWidgetIds(new ComponentName(c, WidgetProvider.class));
        if (ids.length == 0) return;
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        v.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        String server = Net.server(c);
        try {
            if (server == null) {
                v.setTextViewText(R.id.last, c.getString(R.string.widget_connect));
            } else {
                Net.Response r = Net.get(c, server + "/api/phone/widget");
                if (r.status == 401) {
                    v.setTextViewText(R.id.last, c.getString(R.string.widget_sign_in));
                } else if (r.status == 200) {
                    JSONObject j = new JSONObject(r.text());
                    v.setTextViewText(R.id.name, j.optString("name", "Sara"));
                    v.setTextViewText(R.id.mood, j.has("mood") ? "feeling " + j.optString("mood") : "");
                    JSONObject last = j.optJSONObject("last");
                    v.setTextViewText(R.id.last, last != null ? last.optString("text") : "Say hi.");
                    Bitmap face = Net.image(c, server + j.optString("face", "/sara-portrait.jpg"), 192);
                    if (face != null) v.setImageViewBitmap(R.id.face, face);
                    if (last != null) {
                        Intent conv = new Intent(c, MainActivity.class).putExtra("conv", last.optString("conversationId")).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                        v.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(c, 1, conv, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
                    }
                }
            }
        } catch (Exception e) {
            // Offline: keep showing what was there.
            return;
        }
        manager.updateAppWidget(ids, v);
    }
}
