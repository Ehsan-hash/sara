# Your other servers over SSH (2.2)

Sara can work on servers you name over SSH: check a disk, read a log, restart a service, pull and
deploy a project. She signs in with a password once or with a key you give her, and from then on
uses **her own key for that server**. Every command still goes through her approval rules.

Settings → Abilities → **Servers over SSH** (owner only).

## How it works

Sara doesn't speak the SSH protocol herself. She runs the **OpenSSH client that comes with the
operating system** (`ssh`, `ssh-keygen`, `ssh-keyscan`): built into macOS and Windows 10/11, and the
`openssh-client` package on Linux (installed almost everywhere; the Docker image includes it). The
programs are started with an argument list, never through a shell, and always with the same safe
options:

| Option | Why |
|---|---|
| `-F none` | Your own `~/.ssh/config` (aliases, proxies, forwarding) is ignored |
| `StrictHostKeyChecking=yes`, `UserKnownHostsFile=<data>/ssh/known_hosts/<id>`, `HostKeyAlias=sara-<id>`, `HostKeyAlgorithms=<the approved type>`, `UpdateHostKeys=no` | Only the host key you approved for that server is accepted |
| `IdentitiesOnly=yes`, `-i <her key>`, `IdentityAgent=none` | Only her key for that server; your SSH agent and your own keys are never offered |
| `BatchMode=yes` | With a key, nothing can stop and wait for a typed answer |
| `ForwardAgent=no`, `ForwardX11=no`, `ClearAllForwardings=yes` | Nothing is forwarded either way |
| `ControlMaster=no`, `ControlPath=none`, `PermitLocalCommand=no` | No shared connections, no local commands |
| `ConnectTimeout=15`, `ServerAliveInterval=15` | A dead server doesn't hang her |

The command you approve is passed to the server as one argument and run by the server's shell, as
with `ssh server 'command'`. Output is shown with the exit code (long output keeps its start and
end, about 16,000 characters).

## Adding a server

1. **Name, address, port, user.** In Settings, or ask her ("add my web box, deploy@203.0.113.5");
   she then sends you the link to the settings page.
2. **The host key.** She reads the server's host key with `ssh-keyscan` and shows its **SHA256
   fingerprint**. Compare it with the one the server shows for itself: on the server run
   `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` (or ask the hosting company). Only when you
   press *It matches: trust this host key* is it written to her known_hosts file for that server.
   Nothing is sent to the server before that.
3. **Sign in once**, with a password or a key (below).

## The password rule

- You type the password **once**, in the password box on the settings page (`type=password`,
  `autocomplete=off`). Never in the chat: if you type one there by mistake, it is replaced with
  `[REDACTED]` before the message is stored, shown again or sent to a model, and she tells you to
  use the settings page.
- The password reaches `ssh` through **`SSH_ASKPASS`**: a tiny helper in a private `0700` folder
  prints the password from a `0600` file and deletes it as it reads it; the folder is removed right
  after. It is never on a command line, never in an environment variable, never in a log. The
  server's error text is scrubbed of it.
- Right after that first sign-in she **makes her own key** for the server (ed25519, no
  passphrase, comment `sara@<instance>-<date>`), at `<data>/ssh/keys/<id>_ed25519` (`0600`; on
  Windows the file's inherited permissions are removed), and **installs it** in
  `~/.ssh/authorized_keys` on the server: `~/.ssh` is made `700` and the file `600`, a missing last
  newline is fixed, and the line is added only if it isn't there yet. Then she signs in with the key
  to check it works.
- She tells you plainly, in the chat that added the server and on the settings page: that she made
  an SSH key for that server, the full path of the private key on the Sara server, the public key
  line she installed, that she uses the key from now on, and that she **did not keep the password**.
- **Saving the password** happens only if you ask for it in so many words. She first warns that it
  is a security risk (anyone who gets into Sara, or a copy of her data with its master key, could
  sign in to that server with it, and anywhere else that password works; a key opens only this one
  server and can be revoked), and asks for an explicit yes. Then you tick *Save the password for
  future sessions*, tick *I understand the risk* and confirm once more. It is stored **encrypted**
  in her vault (`secrets.enc`, AES-256-GCM, like her API keys) and *Forget the password* removes
  it with one click. A saved password is used only when she has no key for that server.

## Using a key you already have

Paste a private key the server already accepts (the text file that starts with `-----BEGIN OPENSSH`), or give
the full path of a key file **on the computer Sara runs on**. She copies it to
`<data>/ssh/keys/<id>_imported` (`0600`) and signs in with it to check. Keys protected by a
passphrase can't be used (she would have to keep the passphrase); sign in with the password once
instead and she makes her own.

## Every command asks first

`ssh_run` asks you before every command by default, like her shell. You can let it run on its own
in Settings → Abilities → Tools and approvals; even then, commands on the **ask-first list** always
wait for your OK: deleting recursively (`rm -r`, `rm -f`), shutting down or rebooting, disks
(`mkfs`, `dd of=`, `fdisk`), users and passwords, firewalls, `systemctl stop/disable`, recursive
`chmod/chown`, piping a download into a shell, anything touching `authorized_keys`,
`/etc/passwd`, `/etc/shadow`, `/etc/sudoers` or `sshd_config`, writing into system folders,
dropping databases, force pushes, removing containers, `kill -9`. Adding a server, revoking a key,
forgetting a password and removing a server always ask.

## A changed host key

If a server shows a different host key than the one you approved, `ssh` refuses and so does she:
nothing runs, she tells you, and the card shows **Host key changed** with the new fingerprint. If
you know why (a reinstall, a new machine at that address), check the new fingerprint and trust it;
otherwise someone may be between you and the server. She never works around it.

## Revoking and removing

- **Revoke her key**: she signs in with it one last time and removes **exactly her line** from
  `~/.ssh/authorized_keys` (an exact whole-line match; your other keys and look-alike lines stay;
  the file is rewritten in place so its owner and permissions stay), then deletes the key files
  here. A key you gave her is only deleted here: it's yours to remove from the server.
- **Remove**: revokes her key first (for keys she made), then forgets the server, its host key and
  any saved password.

## What is stored where

| What | Where |
|---|---|
| Server list (name, address, port, user, approved fingerprint and key type, her key's path and public line, when it was last used, the last problem) | `<data>/ssh/servers.json` (`0600`) |
| Approved host keys, one file per server | `<data>/ssh/known_hosts/<id>` |
| Her keys | `<data>/ssh/keys/<id>_ed25519` (+ `.pub`), keys you gave her `<id>_imported` |
| A saved password (only if you asked) | the encrypted vault `secrets.enc`, name `ssh:password:<id>` |
| The one-time password helper | `<data>/ssh/tmp/r-*` for the few seconds of the sign-in, then deleted |

The data folder is in her backups, so her keys are too (like her API keys). Data export
(Settings → Data) doesn't include them.

## Who can use it

- **Only the owner**, in her own chats with the owner. Not people in your household (members'
  spaces have no SSH tools and the `/api/ssh` routes answer 403), not the demo server (no SSH at
  all), not group chats, shared work channels or private (off-the-record) chats.
- **Never other apps**: the `ssh_*` tools are taken out of every turn that comes from the
  OpenAI-compatible API (`/v1`), MCP (`ask_sara`), Home Assistant or Alexa, even when you allow her
  tools for other apps; the MCP server's own tools have nothing of it.
- **Nothing leaves this computer** (private local mode): she only reaches servers on this computer
  (`127.0.0.1`, `::1`, `localhost`), like every other connection; anything else, including other
  machines on your home network, is refused before any connection is made. (Decision: the mode
  promises that nothing leaves the computer, and a LAN server is another computer.)

## Her tools

| Tool | Default | What it does |
|---|---|---|
| `ssh_servers` | runs on its own | Lists the servers with fingerprint, key and password status |
| `ssh_connect` | asks | Adds a server and reads its host key; you approve it and sign in in Settings |
| `ssh_run` | asks (risky commands always ask) | Runs one command, shows output and exit code |
| `ssh_forget_password` | asks | Forgets a saved password |
| `ssh_revoke_key` | asks | Removes her line from the server, deletes the key here |
| `ssh_remove_server` | asks | Revokes her key, then forgets the server |

Copying files up and down (scp/sftp) is not part of 2.2.

## Limits

- Installing and revoking her key needs a POSIX shell on the server (Linux, macOS, BSD; the usual
  case). Windows servers running OpenSSH with `cmd.exe` as the shell can be used with a key you give
  her, but she can't install her own there.
- JavaScript can't wipe a string from memory: the password is copied into a buffer that is zeroed
  after use and the request's copy is dropped, but the runtime may keep a copy until it is garbage
  collected.
- Commands run as the user you gave her, with that user's rights. Prefer a normal user with `sudo`
  for the few things that need it over `root`.

Code: `src/ssh.ts` (the manager), `src/tools/ssh.ts` (her tools and the ask-first list),
`web/ssh.js` (the settings page), tests in `test/phase73.test.ts`.
