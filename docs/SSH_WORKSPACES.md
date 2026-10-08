# SSH workspaces

Choose **SSH workspace** in the sidebar. Enter a host or `~/.ssh/config` alias, an optional
username, port, and optional SSH key file. The app creates a workspace, starts `ssh` in its
first terminal, and pins the workspace. Select the pinned workspace to return to its existing tabs, including after an app
restart. **New shell** starts a separate OpenSSH process; it does not resume a remote process.
For a durable remote tmux session with managed reconnect state, use **Settings → Remote sessions**.

You can also create one through the CLI:

```sh
ternline-cli workspace create --name Production --working-directory "$PWD" \
  --ssh-host my-server --ssh-user deploy --ssh-port 2222 --ssh-key /absolute/path/to/private-key
```

Only `--ssh-host` is required among the SSH options. Omit `--ssh-key` to use your SSH agent,
`~/.ssh` keys, and SSH config. SSH options cannot be combined with `--command`. The local
working directory is used to launch OpenSSH; the remote shell starts in the remote user's
normal directory. New terminals and splits opened through either the UI or CLI use the saved
connection. CLI creation does not pin the workspace; use `workspace pin` if desired.

The workspace service saves host, username, port, and the optional key path with the workspace.
Private key contents, passwords, host trust, proxy rules, and other SSH settings remain with OpenSSH.
The SSH connection still uses normal host verification and authentication. Connection details
are included in service snapshots and persist across app restarts.
Older connections saved in Electron renderer storage continue to work. Layout exports do not
include the SSH connection.

Any workspace can be pinned or unpinned with the pin button on its card or its context menu.
Pinning and workspace order are stored by the service. The SSH workspace context menu can edit
connection details for future shells or forget the saved details without closing existing tabs.
Connections created or edited in the dialog also keep their details locally after closing,
so they can be reused or removed under
**Previously saved connections** in the SSH workspace dialog. Removing them does not alter
OpenSSH's configuration, keys, or known hosts.
