package com.backstagecoding.sara;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import android.webkit.CookieManager;

import org.json.JSONObject;

import java.net.URI;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;

/**
 * A live voice call with her (Phase 18), run natively so it keeps going with the screen off or
 * the app in the background. Same protocol as the web page: 16-bit mono PCM at 24 kHz both ways
 * in 40 ms blocks, plus small JSON events. The page shows the call; this service does the audio.
 */
public class CallService extends Service {
    interface Listener {
        void onCallEvent(String json);
    }

    /** The open page, to show the call (captions, status). */
    static volatile Listener listener;
    static volatile boolean running;

    private static final int RATE = 24000;
    private static final int BLOCK = RATE * 40 / 1000;
    private static final int NOTE_ID = 7862;
    private static final String CHANNEL = "call";

    private WebSocket ws;
    private AudioRecord rec;
    private AudioTrack track;
    private AudioManager audio;
    private final LinkedBlockingQueue<byte[]> playQueue = new LinkedBlockingQueue<>();
    private volatile boolean active;
    private volatile long playEndsMs;
    private volatile boolean ended;
    private float floor = 0.006f;
    private float loudMs;
    private String name = "Sara";

    static void start(Context c, String conversationId) {
        start(c, conversationId, null);
    }

    /** Phase 26: answering her call (ringId), so she starts by saying why she called. */
    static void start(Context c, String conversationId, String ringId) {
        Intent i = new Intent(c, CallService.class).putExtra("conv", conversationId);
        if (ringId != null) i.putExtra("ring", ringId);
        c.startForegroundService(i);
    }

    static void hangUp(Context c) {
        if (running) c.startService(new Intent(c, CallService.class).setAction("hangup"));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "hangup".equals(intent.getAction())) {
            // Off the main thread: hanging up sends a last message to the server.
            new Thread(() -> end(getString(R.string.call_you_hung_up), true), "sara-hangup").start();
            return START_NOT_STICKY;
        }
        String conv = intent == null ? null : intent.getStringExtra("conv");
        if (running || conv == null) return START_NOT_STICKY;
        running = true;
        ended = false;
        name = Net.prefs(this).getString("name", "Sara");
        Notification n = note(getString(R.string.call_connecting));
        if (Build.VERSION.SDK_INT >= 30) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else startForeground(NOTE_ID, n);
        String ring = intent.getStringExtra("ring");
        new Thread(() -> run(conv, ring), "sara-call").start();
        return START_NOT_STICKY;
    }

    private Notification note(String status) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(new NotificationChannel(CHANNEL, getString(R.string.channel_call), NotificationManager.IMPORTANCE_LOW));
        PendingIntent hang = PendingIntent.getService(this, 1, new Intent(this, CallService.class).setAction("hangup"), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent open = PendingIntent.getActivity(this, 2, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setColor(Notify.COLOR)
                .setContentTitle(getString(R.string.call_title, name))
                .setContentText(status)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setGroup("call")
                .setCategory(Notification.CATEGORY_CALL)
                .setContentIntent(open);
        if (Build.VERSION.SDK_INT >= 31) {
            // The system's call layout: Hang up is always shown, even on the lock screen.
            b.setStyle(Notification.CallStyle.forOngoingCall(new android.app.Person.Builder().setName(name).setImportant(true).build(), hang));
        } else {
            b.addAction(new Notification.Action.Builder(null, getString(R.string.call_hang_up), hang).build());
        }
        return b.build();
    }

    private void status(String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null && running) nm.notify(NOTE_ID, note(text));
    }

    private void emit(String json) {
        Listener l = listener;
        if (l != null) l.onCallEvent(json);
    }

    private void run(String conv, String ring) {
        String server = Net.server(this);
        try {
            if (server == null) throw new Exception("No server.");
            String wsUrl = server.replaceFirst("^http", "ws") + "/api/live/" + Uri.encode(conv) + (ring != null ? "?ring=" + Uri.encode(ring) : "");
            Map<String, String> h = new HashMap<>();
            h.put("Origin", server);
            h.put("Cookie", CookieManager.getInstance().getCookie(server));
            h.put("User-Agent", "SaraPhone/1");
            ws = WebSocket.connect(new URI(wsUrl), h, new WebSocket.Listener() {
                @Override
                public void onText(String text) {
                    onEvent(text);
                }

                @Override
                public void onBinary(byte[] data) {
                    play(data);
                }

                @Override
                public void onClosed(String reason) {
                    end(reason != null ? reason : getString(R.string.call_disconnected), false);
                }
            });
            startAudio();
        } catch (Exception e) {
            end(e.getMessage() != null ? getString(R.string.call_failed_detail, e.getMessage()) : getString(R.string.call_failed), false);
        }
    }

    private void onEvent(String text) {
        try {
            JSONObject ev = new JSONObject(text);
            String type = ev.optString("type");
            if ("interrupt".equals(type)) silence();
            if ("status".equals(type)) {
                String s = ev.optString("state");
                status(getString("speaking".equals(s) ? R.string.call_speaking : "hearing".equals(s) ? R.string.call_hearing : "connecting".equals(s) ? R.string.call_connecting : R.string.call_listening));
            }
            if ("ended".equals(type)) {
                emit(text);
                ended = true;
                end(ev.optString("reason", ""), false);
                return;
            }
        } catch (Exception ignored) {
            // pass it on anyway
        }
        emit(text);
    }

    @SuppressWarnings("deprecation")
    private synchronized void startAudio() {
        // The call may already have ended (e.g. the server said no right away).
        if (!running) return;
        audio = getSystemService(AudioManager.class);
        audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
        // Loudspeaker unless a headset or Bluetooth is connected (like a speakerphone call).
        if (Build.VERSION.SDK_INT >= 31) {
            AudioDeviceInfo speaker = null;
            boolean headset = false;
            for (AudioDeviceInfo d : audio.getAvailableCommunicationDevices()) {
                int t = d.getType();
                if (t == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) speaker = d;
                if (t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || t == AudioDeviceInfo.TYPE_BLE_HEADSET || t == AudioDeviceInfo.TYPE_USB_HEADSET) headset = true;
            }
            if (!headset && speaker != null) audio.setCommunicationDevice(speaker);
        } else {
            audio.setSpeakerphoneOn(!audio.isWiredHeadsetOn() && !audio.isBluetoothScoOn());
        }

        int inMin = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(inMin, BLOCK * 4));
        if (AcousticEchoCanceler.isAvailable()) {
            AcousticEchoCanceler aec = AcousticEchoCanceler.create(rec.getAudioSessionId());
            if (aec != null) aec.setEnabled(true);
        }
        if (NoiseSuppressor.isAvailable()) {
            NoiseSuppressor ns = NoiseSuppressor.create(rec.getAudioSessionId());
            if (ns != null) ns.setEnabled(true);
        }
        int outMin = AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
        track = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(new AudioFormat.Builder().setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                .setBufferSizeInBytes(Math.max(outMin, BLOCK * 8))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build();
        active = true;
        track.play();
        rec.startRecording();
        new Thread(this::micLoop, "sara-mic").start();
        new Thread(this::playLoop, "sara-play").start();
    }

    /** Mic → server, 40 ms at a time. While she talks, sends silence unless you clearly talk over her. */
    private void micLoop() {
        short[] buf = new short[BLOCK];
        byte[] out = new byte[BLOCK * 2];
        float ms = 1000f * BLOCK / RATE;
        while (active && running) {
            int got = 0;
            while (got < BLOCK && active) {
                int r = rec.read(buf, got, BLOCK - got);
                if (r <= 0) break;
                got += r;
            }
            if (!active || got < BLOCK) continue;
            double sum = 0;
            for (short s : buf) sum += (s / 32768.0) * (s / 32768.0);
            float level = (float) Math.sqrt(sum / BLOCK);
            boolean open = true;
            if (SystemClock.elapsedRealtime() < playEndsMs + 50) {
                loudMs = level > Math.max(0.035f, floor * 6) ? loudMs + ms : Math.max(0, loudMs - ms);
                open = loudMs >= 160;
            } else {
                loudMs = 0;
                if (level < floor * 2) floor = floor * 0.995f + level * 0.005f;
            }
            for (int i = 0; i < BLOCK; i++) {
                short s = open ? buf[i] : 0;
                out[2 * i] = (byte) s;
                out[2 * i + 1] = (byte) (s >> 8);
            }
            try {
                if (ws != null && ws.isOpen()) ws.sendBinary(out.clone());
            } catch (Exception e) {
                end(getString(R.string.call_disconnected), false);
                return;
            }
        }
    }

    private void play(byte[] pcm) {
        if (!active || pcm.length == 0) return;
        long now = SystemClock.elapsedRealtime();
        playEndsMs = Math.max(now, playEndsMs) + (pcm.length / 2) * 1000L / RATE;
        playQueue.offer(pcm);
    }

    private void playLoop() {
        while (active) {
            try {
                byte[] pcm = playQueue.take();
                if (active && pcm.length > 0) track.write(pcm, 0, pcm.length);
            } catch (InterruptedException e) {
                break;
            } catch (Exception ignored) {
                // track stopped
            }
        }
    }

    /** Stop her voice right now (she was interrupted). */
    private void silence() {
        playQueue.clear();
        playEndsMs = 0;
        try {
            track.pause();
            track.flush();
            track.play();
        } catch (Exception ignored) {
            // not playing
        }
    }

    private synchronized void end(String reason, boolean sendHangup) {
        if (!running) return;
        running = false;
        active = false;
        try {
            if (sendHangup && ws != null && ws.isOpen()) ws.sendText("{\"type\":\"hangup\"}");
        } catch (Exception ignored) {
            // gone
        }
        if (ws != null) ws.close();
        playQueue.clear();
        playQueue.offer(new byte[0]);
        try {
            if (rec != null) {
                rec.stop();
                rec.release();
            }
        } catch (Exception ignored) {
            // released
        }
        try {
            if (track != null) {
                track.pause();
                track.flush();
                track.release();
            }
        } catch (Exception ignored) {
            // released
        }
        if (audio != null) {
            if (Build.VERSION.SDK_INT >= 31) audio.clearCommunicationDevice();
            audio.setMode(AudioManager.MODE_NORMAL);
        }
        if (!ended) {
            try {
                emit(new JSONObject().put("type", "ended").put("reason", reason == null ? "" : reason).toString());
            } catch (Exception ignored) {
                // no page
            }
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (running) new Thread(() -> end(getString(R.string.call_ended), true), "sara-hangup").start();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
