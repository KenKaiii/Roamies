# Connecting 9router

In the desktop app, open **Model → 9router**. Enter the server address, the exact
combo or model name from your 9router dashboard, and its API key. `my-combo` is
an example; replace it with your own name. The local address defaults to
`http://127.0.0.1:20128/v1`.

Enable screenshot support only if that model (and every possible model in a
combo) understands images. Roamies only selects models with screenshot support
for its main assistant; other models remain available for subagents.

**Connect and use 9router** sends one short chat request to that model. Your
provider's normal charges may apply. This avoids full model discovery, which can
stall while an unrelated provider is unavailable. Subsequent refreshes check the
dashboard without a key or another chat request; they do not revalidate the key
or model. Use Connect again to verify changed credentials or routing.

A successful connection uses Roamies' existing local-server credential storage.
Leaving the key blank retains the stored key. Reconnecting updates the existing
9router entry. Keys are not included in panel state or project source files.
