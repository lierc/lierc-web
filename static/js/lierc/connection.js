import { Channel } from "./channel.js";

// Events are the browser's own (EventTarget), so a listener that throws
// is reported and the rest still run, and on_message carries on; on() and
// #fire() keep the positional arguments, passed as the event's detail.
export class Connection extends EventTarget {
  constructor(id, host, nick, server_host = null, server_port = null) {
    super();
    this.id = id;
    this.host = host; // the network's name: its alias, else its host
    this.nick = nick;
    // the server, for share links (which only name preset networks); null
    // when the API didn't say (an older one)
    this.server_host = server_host;
    this.server_port = server_port;
    this.connected = false;
    this.channels = [];
    this.isupport = {};
    // highest first, like the server's PREFIX
    this.prefix = [ ["o","@"],["h", "%"],["v","+"]];
    this.chantypes = ["#","&"];
    this.caps_enabled = {};
  }

  on(name, func) {
    this.addEventListener(name, (e) => func(...e.detail));
  }

  #fire(name, ...data) {
    this.dispatchEvent(new CustomEvent(name, { detail: data }));
  }

  remove_channel(name) {
    const i = this.channels.indexOf(this.channel(name));
    if (i != -1) {
      this.channels.splice(i, 1);
      return true;
    }
    return false;
  }

  nick_mode(nick) {
    const first = nick.slice(0,1);
    for (let i=0; i < this.prefix.length; i++) {
      if (first == this.prefix[i][1]) {
        return [nick.slice(1), this.prefix[i][0]];
      }
    }
    return [nick, ""]
  }

  nicks(channel) {
    const ret = {};
    const nicks = channel.nicks;
    const l = nicks.length;

    for (let i=0; i < l; i++) {
      const nick = nicks[i];
      const modes = channel.nick_modes[nick];
      ret[nick] = "";

      for (let j=0; j < this.prefix.length; j++) {
        if (modes && modes.indexOf( this.prefix[j][0]) != -1) {
          ret[nick] += this.prefix[j][1];
        }
      }
    }

    return ret;
  }

  on_message(message) {
    switch (String(message.Command)) {
    case "CONNECT":
      this.#fire("connect", this.id, message);
      this.#fire("status", this.id, message);
      break;

    case "DISCONNECT":
      this.#fire("disconnect", this.id, message);
      this.#fire("status", this.id, message);
      break;

    case "001":
      this.nick = message.Params[0];
      this.#fire("status:raw", this.id, message);
      break;

    // The server's own CAP lines (liercd publishes them as they come) and
    // the stream's replayed "CAP * ACK", from liercd's acked caps. Only ACK
    // and DEL change what's enabled: LS and NEW are offers, and a NAK
    // refuses a request. The list is the last param, "-cap" in an ACK
    // turns a cap off, and an "=value" belongs to the cap.
    case "CAP": {
      const sub = String(message.Params[1]).toUpperCase();
      if (sub != "ACK" && sub != "DEL")
        break;
      const caps = String(message.Params[message.Params.length - 1]).split(" ");
      for (const cap of caps) {
        if (!cap)
          continue;
        const off = sub == "DEL" || cap.startsWith("-");
        const name = cap.replace(/^-/, "").split("=")[0];
        if (off)
          delete this.caps_enabled[name];
        else
          this.caps_enabled[name] = true;
      }
      this.#fire("caps", this.id);
      break;
    }

    // The nick, a token per param, then the trailing "are supported by
    // this server"; the stream's replayed 005s are shaped the same.
    case "005": {
      const parts = message.Params.slice(1, -1).filter((p) => p);

      for (let i=0; i < parts.length; i++) {
        const eq = parts[i].indexOf("=");
        if (eq != -1) {
          const kv = [parts[i].slice(0, eq), parts[i].slice(eq + 1)];
          this.isupport[kv[0]] = kv[1];
          if (kv[0] == "PREFIX") {
            const match = kv[1].match(/\(([^\)]+)\)(.+)/);
            if (match) {
              const modes = match[1].split("");
              const prefixes = match[2].split("");
              this.prefix = [];
              for (let j=0; j < modes.length; j++) {
                this.prefix.push([modes[j], prefixes[j]]);
              }
            }
          }
          else if (kv[0] == "CHANTYPES") {
            this.chantypes = kv[1].split("");
          }
        }
        else {
          this.isupport[parts[i]] = true;
        }
      }
      this.#fire("caps", this.id);
      break;
    }

    case "NICK": {
      const old = message.Prefix.Name;
      const nick = message.Params[0];

      if (old == this.nick) {
        this.nick = nick;
        this.#fire("status:raw", this.id, message);
        this.channels.forEach((channel) => {
          channel.rename_nick(old, nick);
          this.#fire("channel:msg", this.id, channel.name, message);
          this.#fire("channel:nicks", this.id, channel.name, this.nicks(channel))
        });
      }
      else {
        this.channels.forEach( (channel) => {
          if (channel.rename_nick(old, nick)) {
            this.#fire("channel:msg", this.id, channel.name, message);
            this.#fire("channel:nicks", this.id, channel.name, this.nicks(channel))
          }
        });
      }
      break;
    }

    case "PART": {
      const nick = message.Prefix.Name;
      const name = message.Params[0];
      const channel = this.channel(name);

      if (channel) {
        if (nick == this.nick) {
          this.remove_channel(name);
          this.#fire("channel:close", this.id, name);
        }
        else {
          channel.remove_nick(nick);
          this.#fire("channel:msg", this.id, name, message);
          this.#fire("channel:nicks", this.id, name, this.nicks(channel))
        }
      }
      break;
    }

    case "KICK": {
      const name = message.Params[0];
      const nick = message.Params[1];
      const channel = this.channel(name);

      if (channel) {
        if (nick == this.nick) {
          // keep the panel open so the reason stays visible
          this.remove_channel(name);
          this.#fire("channel:msg", this.id, name, message);
          this.#fire("channel:nicks", this.id, name, {});
        }
        else {
          channel.remove_nick(nick);
          this.#fire("channel:msg", this.id, name, message);
          this.#fire("channel:nicks", this.id, name, this.nicks(channel))
        }
      }
      break;
    }

    case "QUIT": {
      const nick = message.Prefix.Name;
      const msg = message.Params[0];

      this.channels.forEach( (channel) => {
        if (channel.remove_nick(nick)) {
          this.#fire("channel:msg", this.id, channel.name, message);
          this.#fire("channel:nicks", this.id, channel.name, this.nicks(channel))
        }
      });
      break;
    }

    case "JOIN": {
      const name = message.Params[0];
      const nick = message.Prefix.Name;

      if (nick == this.nick) {
        // a channel we have already (the stream's replay, after it
        // reopened) is kept: its 353s replace its nicks
        if (!this.channel(name))
          this.channels.push(new Channel(name));
        this.#fire("channel:new", this.id, name, message);
      }
      else {
        const channel = this.channel(name);
        if (channel) {
          channel.add_nick(nick);
          this.#fire("channel:msg", this.id, name, message);
          this.#fire("channel:nicks", this.id, name, this.nicks(channel))
        }
      }
      break;
    }

    // The nick, the channel, then its modes ("+nt") and any mode args;
    // the stream's replayed 324s are shaped the same.
    case "324": {
      const name = message.Params[1];
      const channel = this.channel(name)
      if (channel && message.Params[2] != null) {
        channel.mode = String(message.Params[2]).replace(/^\+/, "");
        this.#fire("channel:mode", this.id, name, channel.mode);
      }
      break;
    }

    case "MODE":
      if (message.Prefix.Name == message.Params[0]) {
        // user mode, ignored for now
      }
      else {
        const name = message.Params[0];
        const channel = this.channel(name);
        if (channel) {
          if (message.Params[1].match(/[+-][voh]/)) {
            channel.nick_mode(message.Params[2], message.Params[1]);
            this.#fire("channel:nicks", this.id, name, this.nicks(channel))
          }
          else {
            channel.set_mode(message.Params[1]);
            this.#fire("channel:mode", this.id, name, channel.mode);
          }
          this.#fire("channel:msg", this.id, name, message);
        }
      }
      break;

    case "332": {
      const name = message.Params[1];
      const topic = message.Params[2];

      const channel = this.channel(name);
      if (channel) {
        channel.topic.value = topic;
        this.#fire("channel:topic", this.id, name, channel.topic);
      }
      break;
    }

    case "333": {
      const name = message.Params[1];
      const channel = this.channel(name);

      if (channel) {
        channel.topic.user = message.Params[2];
        channel.topic.time = message.Params[3];
        this.#fire("channel:topic", this.id, name, channel.topic)
      }
      break;
    }

    case "TOPIC": {
      const nick = message.Prefix.Name;
      const name = message.Params[0];
      const text = message.Params[1];
      const channel = this.channel(name);

      if (channel) {
        channel.topic.value = text;
        channel.topic.time = parseInt((new Date()).getTime() / 1000);
        channel.topic.user = nick;
        this.#fire("channel:msg", this.id, name, message);
        this.#fire("channel:topic", this.id, name, channel.topic);
      }
      break;
    }

    case "353": {
      const name  = message.Params[2];
      const nicks = message.Params[3].split(/\s+/);
      const channel = this.channel(name);

      if (channel) {
        if (channel.synced) {
          channel.reset_nicks();
          channel.synced = false;
        }
        for (const i in nicks) {
          if (nicks[i]) {
            const nick_mode = this.nick_mode(nicks[i]);
            channel.add_nick(nick_mode[0], nick_mode[1]);
          }
        }
      }
      break;
    }

    case "366": {
      const name = message.Params[1];
      const channel = this.channel(name);

      if (channel) {
        channel.synced = true;
        this.#fire("channel:nicks", this.id, name, this.nicks(channel))
      }
      break;
    }

    case "401":
    case "403":
    case "482": {
      const name = message.Params[1];
      this.#fire("channel:error", this.id, name,  message);
      break;
    }

    case "NOTICE": {
      const nick = message.Prefix.Name;
      const name = message.Params[0];

      if (name == this.nick)
        this.#fire("private:msg", this.id, nick, message);
      else
        this.#fire("status", this.id, message);

      break;
    }

    case "TAGMSG": {
      const nick = message.Prefix.Name;
      const name = message.Params[0];
      const text = message.Params[1];
      const priv = this.chantypes.indexOf(name[0]) == -1;
      const channel = this.channel(name);
      let type;

      if (message.Tags?.["+draft/react"] || message.Tags?.["+draft/unreact"]) {
        type = "react";
      } else if (message.Tags && ( message.Tags["+draft/typing"] || message.Tags["+typing"] )) {
        type = "typing";
      } else {
        return;
      }

      if (name == this.nick && priv)
        this.#fire(`private:${type}`, this.id, nick, message);
      else if (priv)
        this.#fire(`private:${type}`, this.id, name, message);
      else if (channel) {
        this.#fire(`channel:${type}`, this.id, name, message);
      }
      break;
    }

    case "PRIVMSG": {
      const nick = message.Prefix.Name;
      const name = message.Params[0];
      const text = message.Params[1];
      const priv = this.chantypes.indexOf(name[0]) == -1;
      const channel = this.channel(name);

      if (name == this.nick && priv)
        this.#fire("private:msg", this.id, nick, message);
      else if (priv)
        this.#fire("private:msg", this.id, name, message);
      else if (channel) {
        channel.bump_nick(nick);
        this.#fire("channel:msg", this.id, name, message);
      }
      break;
    }

    case "PING":
    case "PONG":
      break;

    default:
      this.#fire("status", this.id, message);
    };
  }

  channel(name) {
    name = name.toLowerCase();
    for (let i=0; i < this.channels.length; i++) {
      if (this.channels[i].name.toLowerCase() == name) {
        return this.channels[i];
      }
    }
    return false;
  }

  // Closes the channels not in names, the channels the stream's snapshot
  // says we're in: ones left (or kicked from) while the stream was down.
  keep_channels(names) {
    const keep = new Set(names.map((n) => n.toLowerCase()));
    for (const channel of [...this.channels]) {
      if (!keep.has(channel.name.toLowerCase())) {
        this.remove_channel(channel.name);
        this.#fire("channel:close", this.id, channel.name);
      }
    }
  }

  // Forgets the caps and ISUPPORT of the server connection that's gone
  // (a disconnect, or a stream snapshot, whose replayed CAP ACK and 005
  // follow it), so the next one's are all that count.
  reset_server_state() {
    this.caps_enabled = {};
    this.isupport = {};
    this.#fire("caps", this.id);
  }

  // A reaction is a TAGMSG with +draft/react (or +draft/unreact) and
  // +reply, so it needs message-tags and neither tag refused by the
  // server's CLIENTTAGDENY.
  can_react() {
    return !!this.caps_enabled["message-tags"]
      && !this.client_tag_denied("draft/react")
      && !this.client_tag_denied("reply");
  }

  // A reply is a PRIVMSG with +reply, so it needs message-tags and the tag
  // not refused by the server's CLIENTTAGDENY.
  can_reply() {
    return !!this.caps_enabled["message-tags"]
      && !this.client_tag_denied("reply");
  }

  // CLIENTTAGDENY is a comma-separated list of client tags (no "+") the
  // server drops: "*" for all of them, with "-tag" exempting one.
  client_tag_denied(tag) {
    const deny = this.isupport["CLIENTTAGDENY"];
    if (typeof deny != "string" || deny == "")
      return false;
    const list = deny.split(",");
    if (list.includes(`-${tag}`))
      return false;
    return list.includes("*") || list.includes(tag);
  }

  is_channel(name) {
    return this.chantypes.indexOf(name[0]) != -1;
  }
}
