// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// `add_url`: add a video or a playlist to MeTube, in the quality chosen,
// started at once. A link MeTube refuses (unsupported site, video removed)
// fails the action with MeTube's message; a download that fails later fires
// the `download_failed` trigger. Gladys applies the field defaults to scene
// actions; the quality falls back to "best" anyway.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async add_url(hub, { fields = {} }) {
    await hub.addUrl(fields.url, fields.quality);
    return {};
  },
};
