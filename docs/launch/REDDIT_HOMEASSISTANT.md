# r/homeassistant: post draft

## The rules that matter here

The rules page couldn't be read from this computer (Reddit blocks it, and the rule trackers had no
copy), so **read the sidebar and <https://www.reddit.com/r/homeassistant/about/rules> before
posting**. What's known about the community's norms:

- Posts should be about Home Assistant; promotion is tolerated when it's useful, open source and
  honest about being your own project. No affiliate links.
- This audience values **local control and privacy**, clear install steps (HACS), and screenshots
  of it working. Say plainly what needs the cloud and what doesn't.
- Use the flair the subreddit offers for a project or integration.

Wait until the HACS repository (`farena-ai/hacs-sara`) is public and installs cleanly.

## Post

**Title:** `I made a custom integration that adds my self-hosted AI companion, Sara, as an Assist conversation agent`

**Body:**

> Disclosure: I'm the author; it's MIT and free.
>
> Sara is a self-hosted AI companion (https://github.com/farena-ai/sara). The **Sara
> integration** (installable with HACS as a custom repository: `https://github.com/farena-ai/hacs-sara`)
> connects her to Home Assistant both ways:
>
> **Home Assistant → Sara**
> - A **conversation agent** for Assist and voice satellites ("talk to Sara").
> - **`sara.send_message`**: ask her something from an automation; her reply comes back as the
>   action response.
> - **`notify.sara_note`**: send her a note ("the front door opened"); she answers in her own
>   time.
> - A **last reply** sensor.
>
> **Sara → Home Assistant**
> - With a long-lived token, she can read states and, **with your OK each time**, switch lights,
>   locks, covers, climate, scenes and scripts. Entity names are treated as data, never as
>   instructions.
>
> **Local or cloud:** Sara runs on your own server and can use a local model (Ollama, vLLM,
> llama.cpp), so the conversation stays on your network; cloud models work too if you choose
> them. Sign-in uses a code you approve in Sara (no passwords in Home Assistant).
>
> Needs Home Assistant 2025.6 or newer; tested with 2026.2. One limitation: when she wants
> approval for an action during an Assist conversation, Home Assistant can't approve for you, so
> she says what she wanted to do and you approve it in the Sara app.
>
> Docs: https://github.com/farena-ai/sara/blob/main/docs/HOME_ASSISTANT.md
>
> Feedback from people running voice satellites is especially welcome.

Add 2–3 screenshots: the config flow with the sign-in code, Assist talking to Sara, the device
page.

## Don'ts

- Don't call it "the best" or "the first"; there are other LLM conversation agents.
- Don't hide that Sara is a companion app with a personality; say it once, plainly, and focus the
  post on what the integration does.
