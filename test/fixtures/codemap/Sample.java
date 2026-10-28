package com.example.app;

import java.util.List;
import com.example.app.util.Strings;

public class Sample {
    private int count;

    public Sample(int count) {
        this.count = count;
    }

    public List<String> names(int limit) {
        if (limit > 0) {
            return List.of("a");
        }
        return List.of();
    }

    private static void helper() {
        System.out.println("{");
    }

    interface Listener {
        void onEvent(String name);
    }
}
