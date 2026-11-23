// Replies (IRCv3 +reply): which message a line answers, a plain one-line
// summary of the original, the lines we send, and the "nick: " pre-fill.
// No DOM here, so it can be tested on its own.

// The msgid a message's tags point at: +reply, the reply spec's tag, or
// +draft/reply from older clients (and our own older reactions, in the
// log). Reactions read it here too.
export function referenced_msgid(tags) {
  return tags?.["+reply"] || tags?.["+draft/reply"] || null;
}

// The msgid a PRIVMSG replies to, or null.
export function reply_to(message) {
  if (String(message?.Command).toUpperCase() != "PRIVMSG")
    return null;
  return referenced_msgid(message.Tags);
}

// IRC formatting codes: bold, colour (with its numbers), reset, monospace,
// reverse, italic, strikethrough, underline.
const formatting = /\x03(?:\d{1,2}(?:,\d{1,2})?)?|[\x02\x0f\x11\x16\x1d\x1e\x1f]/g;

export function plain_text(text) {
  return String(text ?? "").replace(formatting, "");
}

// The original as one plain line: its nick and text, a /me as "* nick …".
export function summary(message) {
  const nick = message.Prefix?.Name ?? "";
  let text = message.Params?.[1] ?? "";
  const action = /^\x01ACTION (.*?)\x01?$/.exec(text);
  if (action)
    text = `* ${nick} ${action[1]}`;
  return { nick, text: plain_text(text) };
}

// The lines to send for a reply: the first PRIVMSG carries +reply, the
// rest (a long reply split, or several typed lines) go as they are.
export function reply_lines(lines, msgid) {
  let tagged = false;
  return lines.map((line) => {
    if (tagged || !/^PRIVMSG /i.test(line))
      return line;
    tagged = true;
    return `@+reply=${msgid} ${line}`;
  });
}

// The input with "nick: " in front, so the reply makes sense to clients
// without +reply; not when replying to ourselves, in a private chat (one
// other person), or when it's there already.
export function prefill(input, nick, own_nick, panel_type) {
  const prefix = `${nick}: `;
  if (nick == own_nick || panel_type == "private" || input.startsWith(prefix))
    return input;
  return prefix + input;
}
