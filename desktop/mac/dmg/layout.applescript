-- The disk image's Finder window (build.sh runs this on the mounted read-write image):
-- icon view, no toolbar / status bar / sidebar, 600 x 400 points, 128-point icons, Sara on the
-- left, the Applications shortcut on the right, the background with the arrow and "Drag Sara to
-- Applications" (make-background.py; the positions match its ICON_LEFT / ICON_RIGHT).
-- Usage: osascript layout.applescript <volume name>
-- Finder only writes the whole layout (the background and icon size too, in .DS_Store) when the
-- volume is addressed as a disk by its name, so no other volume of that name may be mounted
-- (build.sh checks; with one mounted it stops: eject the other one).
on run argv
  set volname to item 1 of argv
  with timeout of 300 seconds
    tell application "Finder"
      tell disk volname
        open
        delay 1
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        -- The title bar (no toolbar) is 28 points: the content is 600 x 400.
        set the bounds of container window to {160, 120, 760, 548}
        set viewOptions to the icon view options of container window
        set arrangement of viewOptions to not arranged
        set icon size of viewOptions to 128
        set text size of viewOptions to 13
        set shows item info of viewOptions to false
        set background picture of viewOptions to file ".background:background.tiff"
        set position of item "Sara.app" of container window to {160, 196}
        set position of item "Applications" of container window to {440, 196}
        -- Close and open again so Finder writes all of it into the volume's .DS_Store.
        close
        open
        update without registering applications
        delay 2
        close
      end tell
    end tell
  end timeout
  return "ok"
end run
