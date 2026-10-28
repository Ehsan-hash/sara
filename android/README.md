# The Android app

A small phone app for your Sara server. It isn't required: Sara also installs from the browser
as a home-screen app. The Android app adds:

- **A home-screen widget**: her face for her current mood, how she's feeling, and her last
  message. Tap it to open the conversation.
- **Notifications from the app itself**: about every 15 minutes Android lets the app check for
  messages she sent on her own (texting first, reminders, finished jobs, the morning briefing).
  While the app is open, messages show up instantly in the chat.
- Microphone, camera and photo picker inside the app.

It works with any Sara server: on first start you type your server's address (the one you open
in your browser). It uses only Android itself, with no extra libraries and no Google services.
The whole app is about 100 KB.

## Install it on your phone

1. Get the APK file: build it (below), or download it from wherever your server's owner shares it.
2. Open it on the phone. Android asks to allow installs from that app (your browser or Files):
   allow it once.
3. Open **Sara**. Easiest: on your computer open Settings → Devices and sign-in → **Add a phone
   or computer**, then scan the code with the phone's camera and choose **Open in the Sara app**.
   Or type your server's address and the short code, and press **Connect**. (Without a code you
   sign in with the owner token.) No server yet? Press **Try the demo**.
4. In Settings → Connections → **Phone app**, press **Add her to your home screen**.

## Build it

You need Android Studio (or just the Android SDK) and Java 17 or newer.

```sh
cd android
./gradlew assembleDebug        # Windows: gradlew.bat assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

To make a release build for sharing, create `android/keystore.properties` (never committed):

```properties
storeFile=../.secrets/sara-release.jks
storePassword=…
keyAlias=sara
keyPassword=…
```

then run `./gradlew assembleRelease`.

## What it does besides the web app

- **Reply from a notification**: type into her notification; her answer comes back as one.
- **Send to Sara**: share text, links or photos from any app; they land in the message box.
- **Live calls keep going with the screen off**: the call runs in the app itself (with a call
  notification and a Hang Up button), not in the web page.
- **Instant notifications** (Settings → Phone and notifications, optional): the app keeps one quiet
  connection to your server and shows her messages the moment they arrive. Android shows a small
  "Instant notifications are on" note for this (in the Silent section). Off: she's checked about
  every 15 minutes. No Google Firebase or other outside service is involved either way.
- **App lock**: fingerprint, face or your screen lock after 30 seconds away; the app is hidden in
  the recent-apps view while the lock is on. **Hide the message text on the lock screen** is
  there too.

## Notes

- **Notification timing** without instant notifications: Android decides when background checks
  run (usually every 15–30 minutes, longer when the battery is low).
- **Google sign-in** (Gmail/Calendar) opens in the phone's browser, because Google doesn't allow
  signing in inside apps' web views. It still connects your server; sign in again in the app
  afterwards if it asks.
- The app's name on the home screen is "Sara"; inside the app and on the widget she uses the name
  you gave her.
- Google Play: the app uses two kinds of foreground service, which the Play Console asks about
  (Phase 19): *microphone* (live calls) and *remote messaging* (instant notifications).
- iPhone: see `ios/README.md`.
