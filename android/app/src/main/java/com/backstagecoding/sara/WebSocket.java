package com.backstagecoding.sara;

import android.util.Base64;

import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * A small WebSocket client (RFC 6455) for live calls: Android has no built-in one and the app
 * uses no libraries. Text and binary messages, fragmentation, ping/pong, close. TLS uses the
 * system's certificate checks plus a host-name check.
 */
final class WebSocket {
    interface Listener {
        void onText(String text);

        void onBinary(byte[] data);

        /** The connection ended (closed by the server, or a network error). */
        void onClosed(String reason);
    }

    private static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private final Socket socket;
    private final DataInputStream in;
    private final OutputStream out;
    private final Listener listener;
    private final SecureRandom random = new SecureRandom();
    private final Object writeLock = new Object();
    private volatile boolean open = true;

    private WebSocket(Socket socket, Listener listener) throws IOException {
        this.socket = socket;
        this.in = new DataInputStream(socket.getInputStream());
        this.out = socket.getOutputStream();
        this.listener = listener;
    }

    static WebSocket connect(URI uri, Map<String, String> headers, Listener listener) throws IOException {
        boolean tls = "wss".equals(uri.getScheme());
        String host = uri.getHost();
        int port = uri.getPort() != -1 ? uri.getPort() : tls ? 443 : 80;
        Socket raw = new Socket();
        raw.connect(new InetSocketAddress(host, port), 15000);
        Socket s = raw;
        if (tls) {
            SSLSocket ssl = (SSLSocket) ((SSLSocketFactory) SSLSocketFactory.getDefault()).createSocket(raw, host, port, true);
            ssl.startHandshake();
            if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(host, ssl.getSession())) {
                ssl.close();
                throw new IOException("The server's certificate is not for " + host);
            }
            s = ssl;
        }
        s.setSoTimeout(0);
        s.setTcpNoDelay(true);
        WebSocket ws = new WebSocket(s, listener);
        ws.handshake(uri, host, port, tls, headers);
        Thread reader = new Thread(ws::readLoop, "sara-ws");
        reader.setDaemon(true);
        reader.start();
        return ws;
    }

    private void handshake(URI uri, String host, int port, boolean tls, Map<String, String> headers) throws IOException {
        byte[] nonce = new byte[16];
        random.nextBytes(nonce);
        String key = Base64.encodeToString(nonce, Base64.NO_WRAP);
        String path = (uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath()) + (uri.getRawQuery() != null ? "?" + uri.getRawQuery() : "");
        boolean defaultPort = port == (tls ? 443 : 80);
        StringBuilder req = new StringBuilder()
                .append("GET ").append(path).append(" HTTP/1.1\r\n")
                .append("Host: ").append(host).append(defaultPort ? "" : ":" + port).append("\r\n")
                .append("Upgrade: websocket\r\nConnection: Upgrade\r\n")
                .append("Sec-WebSocket-Key: ").append(key).append("\r\n")
                .append("Sec-WebSocket-Version: 13\r\n");
        for (Map.Entry<String, String> h : headers.entrySet()) {
            if (h.getValue() != null) req.append(h.getKey()).append(": ").append(h.getValue()).append("\r\n");
        }
        req.append("\r\n");
        out.write(req.toString().getBytes(StandardCharsets.UTF_8));
        out.flush();

        String status = readLine();
        if (status == null || !status.matches("HTTP/1\\.1 101.*")) {
            close();
            throw new IOException(status != null && status.contains("401") ? "Not signed in." : "The server refused the call (" + status + ").");
        }
        String accept = null;
        for (String line = readLine(); line != null && !line.isEmpty(); line = readLine()) {
            int i = line.indexOf(':');
            if (i > 0 && line.substring(0, i).trim().equalsIgnoreCase("Sec-WebSocket-Accept")) accept = line.substring(i + 1).trim();
        }
        try {
            byte[] sha = MessageDigest.getInstance("SHA-1").digest((key + GUID).getBytes(StandardCharsets.US_ASCII));
            if (!Base64.encodeToString(sha, Base64.NO_WRAP).equals(accept)) {
                close();
                throw new IOException("Bad WebSocket handshake.");
            }
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
    }

    private String readLine() throws IOException {
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') sb.append((char) c);
            if (sb.length() > 8192) throw new IOException("Header line too long.");
        }
        return c == -1 && sb.length() == 0 ? null : sb.toString();
    }

    private void readLoop() {
        java.io.ByteArrayOutputStream parts = new java.io.ByteArrayOutputStream();
        int partsType = 0;
        String reason = "The call was disconnected.";
        try {
            while (open) {
                int b0 = in.readUnsignedByte();
                int b1 = in.readUnsignedByte();
                boolean fin = (b0 & 0x80) != 0;
                int op = b0 & 0x0f;
                long len = b1 & 0x7f;
                if (len == 126) len = in.readUnsignedShort();
                else if (len == 127) len = in.readLong();
                if (len < 0 || len > 16 * 1024 * 1024) throw new IOException("Frame too large.");
                byte[] mask = null;
                if ((b1 & 0x80) != 0) {
                    mask = new byte[4];
                    in.readFully(mask);
                }
                byte[] payload = new byte[(int) len];
                in.readFully(payload);
                if (mask != null) for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

                if (op == 0x8) {
                    if (payload.length > 2) reason = new String(payload, 2, payload.length - 2, StandardCharsets.UTF_8);
                    send(0x8, payload.length >= 2 ? new byte[] {payload[0], payload[1]} : new byte[0]);
                    break;
                } else if (op == 0x9) {
                    send(0xA, payload);
                } else if (op == 0xA) {
                    // pong: nothing to do
                } else if (op == 0x1 || op == 0x2) {
                    if (fin) deliver(op, payload);
                    else {
                        parts.reset();
                        parts.write(payload);
                        partsType = op;
                    }
                } else if (op == 0x0 && partsType != 0) {
                    parts.write(payload);
                    if (fin) {
                        deliver(partsType, parts.toByteArray());
                        parts.reset();
                        partsType = 0;
                    }
                }
            }
        } catch (IOException e) {
            if (!open) reason = null;
        } finally {
            boolean wasOpen = open;
            open = false;
            try {
                socket.close();
            } catch (IOException ignored) {
                // closed
            }
            if (wasOpen || reason != null) listener.onClosed(reason);
        }
    }

    private void deliver(int op, byte[] data) {
        if (op == 0x1) listener.onText(new String(data, StandardCharsets.UTF_8));
        else listener.onBinary(data);
    }

    boolean isOpen() {
        return open;
    }

    void sendText(String text) throws IOException {
        send(0x1, text.getBytes(StandardCharsets.UTF_8));
    }

    void sendBinary(byte[] data) throws IOException {
        send(0x2, data);
    }

    private void send(int op, byte[] payload) throws IOException {
        int len = payload.length;
        byte[] head = new byte[len < 126 ? 6 : len < 65536 ? 8 : 14];
        head[0] = (byte) (0x80 | op);
        int i;
        if (len < 126) {
            head[1] = (byte) (0x80 | len);
            i = 2;
        } else if (len < 65536) {
            head[1] = (byte) (0x80 | 126);
            head[2] = (byte) (len >> 8);
            head[3] = (byte) len;
            i = 4;
        } else {
            head[1] = (byte) (0x80 | 127);
            for (int k = 0; k < 8; k++) head[2 + k] = (byte) ((long) len >> (56 - 8 * k));
            i = 10;
        }
        byte[] mask = new byte[4];
        random.nextBytes(mask);
        System.arraycopy(mask, 0, head, i, 4);
        byte[] body = new byte[len];
        for (int k = 0; k < len; k++) body[k] = (byte) (payload[k] ^ mask[k & 3]);
        synchronized (writeLock) {
            out.write(head);
            out.write(body);
            out.flush();
        }
    }

    void close() {
        if (!open) return;
        open = false;
        try {
            send(0x8, new byte[] {0x03, (byte) 0xE8});
        } catch (IOException ignored) {
            // already gone
        }
        try {
            socket.close();
        } catch (IOException ignored) {
            // closed
        }
    }
}
