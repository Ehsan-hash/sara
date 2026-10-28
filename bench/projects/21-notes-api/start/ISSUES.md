# Open issues

## #41 Expired tokens still work for a few minutes

> I signed in, left the tab open, came back 18 minutes later and could still list and edit my
> notes with the old token. Tokens are supposed to last 15 minutes.

## #44 Viewers (and editors) can delete other people's notes

> Cam is a viewer. Bea shared a note with him (read only) and he managed to delete it. We also saw
> an editor delete a note that was only shared with her for editing.

## #47 `Authorization: bearer …` is rejected

> Our mobile client sends the scheme in lower case (`bearer <token>`) and gets 401 for everything.
> The docs say the scheme name is case-insensitive.
