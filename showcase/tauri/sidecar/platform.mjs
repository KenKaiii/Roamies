// What the model is told about the computer it's on, and which of the hands helper's features this one has.
// Pure, so the wording for each system is tested without running on it (test/platform.test.mjs).

/** The prompt's platform line. "darwin" alone left the model using PC habits on a Mac (Cmd+End, cat -A), and the
 *  same goes the other way on Windows (Cmd, ls, grep). */
export function platformLine(platform, { macVersion = '', arch = '', release = '' } = {}) {
  if (platform === 'darwin') {
    return `Platform: macOS${macVersion ? ` ${macVersion}` : ''} on ${arch === 'arm64' ? 'Apple silicon' : 'Intel'}. Use Mac keys: Cmd, not Ctrl; the end and start of a document are Cmd+Down and Cmd+Up, of a line Cmd+Right and Cmd+Left (Home and End don't move the cursor in most Mac apps). Shell commands are the macOS (BSD) versions, not GNU: no cat -A, grep -P, date -d or sed -i without ''.`;
  }
  if (platform === 'win32') {
    const build = +String(release).split('.')[2] || 0;
    const name = build ? `Windows ${build >= 22000 ? '11' : '10'}` : 'Windows';
    return `Platform: ${name} on ${arch === 'arm64' ? 'Arm' : 'x64'}. Use Windows keys: Ctrl, not Cmd (in act_in_app steps cmd means Ctrl); the end and start of a document are Ctrl+End and Ctrl+Home, of a line End and Home. run_command runs in cmd.exe: use Windows commands (dir, type, where, findstr) or powershell -NoProfile -Command "…", not Unix ones like ls -la, cat, grep or sed. Paths look like C:\\Users\\name, and ~ is the user's folder.`;
  }
  return `Platform: ${platform}.`;
}

/** Whether the hands helper's tools are on: always on macOS (they explain what's missing), elsewhere when the
 *  helper is there (Roamies sets ROAMIES_HANDS to it). */
export const hasHands = (platform, hands) => platform === 'darwin' || !!hands;

/** Ask About an Area (the snap shortcut and menu item): the helper's area selection, on macOS and Windows. */
export const canSnap = (platform, hands) => platform === 'darwin' || (platform === 'win32' && !!hands);

/** Circling something while holding the talk keys: the voice helper draws it, on macOS and Windows. */
export const canCircle = (platform) => platform === 'darwin' || platform === 'win32';
