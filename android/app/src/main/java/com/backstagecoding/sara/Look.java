package com.backstagecoding.sara;

import android.content.Context;
import android.graphics.Color;

/**
 * The new look's colours (web/theme.css, docs/design/NEW_LOOK.md) for the app's own screens:
 * Night (the default) and Day. The page tells the app which one it shows (MainActivity's look
 * script), and the app keeps that choice for its own screens, the splash and the first paint.
 */
final class Look {
    final boolean day;
    final int bg, surface1, surface2, surface3, hairline, hairlineStrong;
    final int text1, text2, text3, accentText, danger;
    /** Main buttons: the deep rose → violet gradient of the web's buttons (white text at 5:1+). */
    final int btnFrom, btnTo, onBtn;
    /** The soft glows behind the card (the web's --page-glow). */
    final int glowViolet, glowRose;
    /** The ring around her picture: the accent gradient. */
    final int accentFrom, accentTo;
    final int ripple;

    static final Look NIGHT = new Look(false);
    static final Look DAY = new Look(true);

    private Look(boolean day) {
        this.day = day;
        if (day) {
            bg = Color.parseColor("#FAF7F5");
            surface1 = Color.parseColor("#FFFFFF");
            surface2 = Color.parseColor("#F4EEF1");
            surface3 = Color.parseColor("#EBE2EA");
            hairline = Color.argb(23, 46, 22, 54);
            hairlineStrong = Color.argb(41, 46, 22, 54);
            text1 = Color.parseColor("#221A2A");
            text2 = Color.parseColor("#5E5469");
            text3 = Color.parseColor("#736A7E");
            accentText = Color.parseColor("#B8436A");
            danger = Color.parseColor("#C0303A");
            btnFrom = Color.parseColor("#B8436A");
            btnTo = Color.parseColor("#7A50D2");
            glowViolet = Color.argb(18, 155, 107, 255);
            glowRose = Color.argb(15, 224, 96, 126);
            ripple = 0x1A2E1636;
        } else {
            bg = Color.parseColor("#0F0D17");
            surface1 = Color.parseColor("#17141F");
            surface2 = Color.parseColor("#1E1A29");
            surface3 = Color.parseColor("#282236");
            hairline = Color.argb(20, 255, 255, 255);
            hairlineStrong = Color.argb(36, 255, 255, 255);
            text1 = Color.parseColor("#F1EDF7");
            text2 = Color.parseColor("#AEA6BD");
            text3 = Color.parseColor("#8E86A0");
            accentText = Color.parseColor("#F08AA5");
            danger = Color.parseColor("#FF6B7D");
            btnFrom = Color.parseColor("#A8456D");
            btnTo = Color.parseColor("#6D48C4");
            glowViolet = Color.argb(38, 155, 107, 255);
            glowRose = Color.argb(28, 224, 96, 126);
            ripple = 0x22FFFFFF;
        }
        onBtn = Color.WHITE;
        accentFrom = Color.parseColor("#E0607E");
        accentTo = Color.parseColor("#9B6BFF");
    }

    /** The theme the page showed last on this phone (Night until it says otherwise). */
    static Look saved(Context c) {
        return "day".equals(Net.prefs(c).getString("look", "night")) ? DAY : NIGHT;
    }

    /** Remembers the page's theme; true when it changed. */
    static boolean save(Context c, boolean day) {
        if (saved(c).day == day) return false;
        Net.prefs(c).edit().putString("look", day ? "day" : "night").apply();
        return true;
    }

    /** True for colours dark icons should sit on (WCAG relative luminance above the midpoint). */
    static boolean isLight(int color) {
        double r = lin(Color.red(color)), g = lin(Color.green(color)), b = lin(Color.blue(color));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179;
    }

    private static double lin(int v) {
        double s = v / 255.0;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }

    /** "#rrggbb" from the page (anything else: the fallback). */
    static int parse(String s, int fallback) {
        if (s == null || !s.matches("#[0-9a-fA-F]{6}")) return fallback;
        return Color.parseColor(s);
    }
}
