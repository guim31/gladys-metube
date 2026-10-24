# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

The integration stores under `/data` only the address of the MeTube server read
last and the keys of the downloads already seen (their link and the time they
were added). The user name and password of a reverse proxy in front of MeTube
stay in the configuration of Gladys: they are sent to that address only, in the
`Authorization` header (basic authentication: prefer HTTPS behind a reverse
proxy), and never written to the logs. A link added from Gladys is logged with
its host only (it may carry a token). The integration only talks to the address
configured, over the local network; no cloud service, no inbound port. It adds
downloads and starts the waiting ones; it never deletes a download nor a file.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and MeTube and yt-dlp themselves.
