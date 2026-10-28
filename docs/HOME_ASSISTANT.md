# Sara and Home Assistant

Sara and Home Assistant work both ways. Each direction is set up on its own; you can use either
or both.

## 1. Sara controls your home

Sara reads the state of your home and, with your OK, changes things (lights, switches, locks,
covers, climate, scenes, scripts).

1. In Home Assistant: your profile → **Security → Long-lived access tokens → Create token**.
2. In Sara: **Settings → Abilities → Home Assistant**. Enter your Home Assistant address (for
   example `http://homeassistant.local:8123` or your Nabu Casa address) and the token.

The token is kept in Sara's encrypted vault. Reading states runs on its own; anything that changes
something asks you first, every time. Names in Home Assistant are treated as information only,
never as instructions to her. See [PRIVACY.md](PRIVACY.md) for what this sends.

## 2. Home Assistant talks to Sara

The **Sara integration for Home Assistant** (in [`integrations/home-assistant/`](../integrations/home-assistant/README.md),
installable with HACS) makes Sara:

- a **conversation agent** for Assist and voice satellites (Settings → Voice assistants);
- an action, **`sara.send_message`**, that asks her something from an automation and returns her
  reply;
- **`notify.sara_note`**, for notes she answers in her own time;
- a **last reply** sensor (its state is when she last answered; her words are in its `text`
  attribute, which Home Assistant doesn't keep in its history).

It signs in like the terminal client and the VS Code extension ([clients.md](clients.md)): Home
Assistant shows a code, you approve it in Sara under **Settings → Data & health → Devices and
sign-in** (or on the `/device` page), confirming with your owner token, two-step code or passkey.
Home Assistant then has its own device token, listed as "Home Assistant"; sign it out there to end
it. That token only reaches Home Assistant's own conversations (titled "Home Assistant" in Sara):
not your other chats, settings or memory pages. Like other apps, Home Assistant conversations
don't bring up things from your private chats, and her tools stay off there unless you allow
other apps to use them (Settings → Connections → Other apps). `sara.send_message` only works in
conversations the integration started.

Her safety layer runs on the Sara server and is the same as in her own apps: the AI disclosure
is shown (and must be accepted once during setup), crisis resources still appear, and replies her
safety checks replace arrive replaced. When she asks for an approval during a Home Assistant
conversation, Home Assistant can't answer for you: it declines and her reply says what she wanted
to do, so you can ask again in the Sara app.

Install and options: [integrations/home-assistant/README.md](../integrations/home-assistant/README.md).

## Both at once

With both set up, you can say to a voice satellite "Sara, is the garage door open?" and she reads
it through direction 1. Changes she'd make that way need an approval, which Home Assistant
declines (see above): approve changes in the Sara app, or let Home Assistant's own assistant
handle device commands and use Sara for conversation.
