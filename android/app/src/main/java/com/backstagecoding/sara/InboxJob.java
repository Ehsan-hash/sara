package com.backstagecoding.sara;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * About every 15 minutes (Android decides the exact time): checks for messages she sent on her
 * own (texting first, reminders, finished jobs, the morning briefing), shows them as
 * notifications, and refreshes the widget. While the app is open the chat shows them instead.
 */
public class InboxJob extends JobService {
    private static final int JOB_ID = 7860;

    static void schedule(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null || js.getPendingJob(JOB_ID) != null) return;
        js.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(c, InboxJob.class))
                .setPeriodic(15 * 60 * 1000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build());
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try {
                check(getApplicationContext());
                if (Places.on(getApplicationContext())) Places.sync(getApplicationContext());
                WidgetProvider.refresh(getApplicationContext());
            } finally {
                jobFinished(params, false);
            }
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }

    static void check(Context c) {
        String server = Net.server(c);
        if (server == null) return;
        long after = Net.prefs(c).getLong("lastId", 0);
        try {
            Net.Response r = Net.get(c, server + "/api/phone/inbox?after=" + after);
            if (r.status != 200) return;
            JSONObject j = new JSONObject(r.text());
            long latest = j.optLong("latest", after);
            Net.prefs(c).edit().putString("name", j.optString("name", "Sara")).apply();
            // First check after connecting: start from now, don't replay old messages.
            if (after > 0 && !MainActivity.visible) {
                JSONArray list = j.optJSONArray("messages");
                String name = j.optString("name", "Sara");
                for (int i = 0; list != null && i < list.length(); i++) {
                    JSONObject m = list.getJSONObject(i);
                    Notify.message(c, name, m.optString("conversationId"), m.optLong("id"), m.optString("text"), m.optString("kind"));
                }
            }
            Net.prefs(c).edit().putLong("lastId", Math.max(after, latest)).apply();
        } catch (Exception ignored) {
            // offline: try next time
        }
    }
}
