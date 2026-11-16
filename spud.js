// Spud's performance engine: face rig + emotions + body movement.
//
// Each style has a base mood (how Spud looks and moves). While a song plays,
// the music's live energy pushes the mood from "calm" to "intense", beats
// trigger bounces and gestures, and sudden surges (a drop, a big chorus)
// make Spud react with excitement.
(function () {
  const $ = (id) => document.getElementById(id);
  const el = {
    body: $("body"),
    armL: $("armL"),
    holdR: $("holdR"),
    mouth: $("mouth"),
    mouthClip: $("mouthClipPath"),
    tongue: $("tongue"),
    browL: $("browL"),
    browR: $("browR"),
    cheekL: $("cheekL"),
    cheekR: $("cheekR"),
    lidTopL: $("lidTopL"),
    lidTopR: $("lidTopR"),
    lidBotL: $("lidBotL"),
    lidBotR: $("lidBotR"),
    looks: document.querySelectorAll(".look"),
  };

  // ---------- moods ----------
  // lid: how closed the eyes are (0 open .. 1 shut), squint: lower lids up (happy),
  // smile: -1 fierce .. 1 big grin, brow: raise in px, tilt: + angry / - tender,
  // sway: degrees, swaySpeed: sways per beat, bounce: px per beat, jump: px at high energy,
  // arm: left-arm gesture, look: where the pupils go.
  const MOODS = {
    pop:       { bpm: 118, lid: 0.05, squint: 0.3, smile: 0.8, brow: 3, tilt: 0, sway: 5, swaySpeed: 0.5, bounce: 6, jump: 8, arm: "wave", look: [0, -1] },
    rnb:       { bpm: 72, lid: 0.45, squint: 0.15, smile: 0.25, brow: 4, tilt: -6, sway: 7, swaySpeed: 0.25, bounce: 2, jump: 0, arm: "feel", look: [-2, -4], lean: 4 },
    rock:      { bpm: 140, lid: 0.2, squint: 0, smile: -0.6, brow: -3, tilt: 18, sway: 3, swaySpeed: 0.5, bounce: 9, jump: 14, arm: "pump", look: [0, 1], headbang: true },
    hiphop:    { bpm: 92, lid: 0.3, squint: 0.1, smile: 0.35, brow: 1, tilt: 4, sway: 3, swaySpeed: 0.5, bounce: 7, jump: 0, arm: "point", look: [3, 0], browAsym: 9 },
    afrobeats: { bpm: 105, lid: 0.1, squint: 0.35, smile: 0.9, brow: 3, tilt: 0, sway: 8, swaySpeed: 0.5, bounce: 5, jump: 6, arm: "dance", look: [0, -1], hips: 7 },
    country:   { bpm: 100, lid: 0.1, squint: 0.3, smile: 0.7, brow: 2, tilt: -2, sway: 5, swaySpeed: 0.5, bounce: 4, jump: 0, arm: "wave", look: [-1, -1] },
    reggae:    { bpm: 75, lid: 0.4, squint: 0.25, smile: 0.6, brow: 1, tilt: -2, sway: 6, swaySpeed: 0.5, bounce: 3, jump: 0, arm: "feel", look: [2, -2], hips: 4 },
    gospel:    { bpm: 110, lid: 0.55, squint: 0.2, smile: 0.7, brow: 6, tilt: -8, sway: 6, swaySpeed: 0.5, bounce: 4, jump: 6, arm: "raise", look: [0, -5] },
    edm:       { bpm: 128, lid: 0, squint: 0.2, smile: 0.8, brow: 5, tilt: 0, sway: 3, swaySpeed: 1, bounce: 10, jump: 18, arm: "pump", look: [0, -2] },
    lullaby:   { bpm: 70, lid: 0.7, squint: 0.1, smile: 0.4, brow: 3, tilt: -5, sway: 4, swaySpeed: 0.25, bounce: 0, jump: 0, arm: "rock", look: [0, 3] },
  };
  let mood = MOODS.pop;

  // ---------- smoothed state ----------
  const st = {
    open: 0, lid: 0, squint: 0, smile: 0.15, brow: 0, tilt: 0, browAsym: 0, cheek: 0.55,
    lookX: 0, lookY: 0, x: 0, y: 0, rot: 0, sx: 1, sy: 1, arm: 0, mic: 0,
  };
  const ease = (key, target, k) => (st[key] += (target - st[key]) * k);

  // music analysis
  let fast = 0;        // loudness right now
  let mid = 0;         // loudness over the last half second
  let slow = 0;        // loudness over the last few seconds
  let peak = 0.25;     // adaptive "loud" reference
  let beatKick = 0;    // decays after each beat
  let beatCount = 0;
  let wow = 0;         // excitement burst after a surge
  let lastWow = -1e9;
  let lastBeat = -1e9;
  let bassAvg = 0;
  let blinkAt = 0;
  let bow = 0;         // end-of-song bow, 1 -> 0

  // ---------- drawing ----------
  function drawFace() {
    const open = Math.max(0, Math.min(1, st.open));
    const smile = st.smile;
    const w = 22 - open * 4 + Math.max(0, smile) * 3;
    const corner = -smile * 6;
    const top = -open * 16 + smile * 2;
    const bottom = open * 34 + Math.max(0, smile) * 10 + 3;
    const d = `M${-w} ${corner.toFixed(1)} Q0 ${top.toFixed(1)} ${w} ${corner.toFixed(1)} Q0 ${bottom.toFixed(1)} ${-w} ${corner.toFixed(1)}Z`;
    el.mouth.setAttribute("d", d);
    el.mouthClip.setAttribute("d", d);
    el.tongue.setAttribute("ry", (open * 10).toFixed(1));
    el.tongue.setAttribute("cy", (bottom * 0.62).toFixed(1));

    const lid = Math.max(0, Math.min(1, st.lid));
    const squint = Math.max(0, Math.min(1, st.squint));
    el.lidTopL.style.transform = el.lidTopR.style.transform = `translateY(${(lid * 29).toFixed(1)}px)`;
    el.lidBotL.style.transform = el.lidBotR.style.transform = `translateY(${(-squint * 25).toFixed(1)}px)`;

    // Brows: raise + tilt (positive tilt = inner ends down = fierce).
    const lift = -st.brow;
    el.browL.style.transform = `translateY(${(lift - st.browAsym).toFixed(1)}px) rotate(${st.tilt.toFixed(1)}deg)`;
    el.browR.style.transform = `translateY(${lift.toFixed(1)}px) rotate(${(-st.tilt).toFixed(1)}deg)`;

    const c = Math.max(0.2, Math.min(1, st.cheek));
    el.cheekL.style.opacity = el.cheekR.style.opacity = c.toFixed(2);

    el.looks.forEach((g) => (g.style.transform = `translate(${st.lookX.toFixed(1)}px, ${st.lookY.toFixed(1)}px)`));
  }

  function drawBody() {
    el.body.style.transform =
      `translate(${st.x.toFixed(1)}px, ${st.y.toFixed(1)}px) rotate(${st.rot.toFixed(2)}deg) scale(${st.sx.toFixed(3)}, ${st.sy.toFixed(3)})`;
    el.armL.style.transform = `rotate(${st.arm.toFixed(1)}deg)`;
    el.holdR.style.transform = `translate(${(-st.mic * 3).toFixed(1)}px, ${(-st.mic * 4).toFixed(1)}px)`;
  }

  // ---------- the performance ----------
  // t: ms, voice/bass: 0..1 band levels, songTime: seconds into the song
  function perform(t, voice, bass, songTime) {
    const m = mood;
    const beatLen = 60 / m.bpm;
    const phase = songTime / beatLen; // beats since start

    // Loudness tracking.
    const loud = voice * 0.6 + bass * 0.4;
    fast += (loud - fast) * 0.3;
    mid += (loud - mid) * 0.06;
    slow += (loud - slow) * 0.01;
    peak = Math.max(peak * 0.9995, fast, 0.08);
    const energy = Math.max(0, Math.min(1, mid / (peak * 0.7))); // 0 calm .. 1 full power

    // Beats: a bass hit above its recent average, at most ~4 per second.
    bassAvg = bassAvg * 0.95 + bass * 0.05;
    let onBeat = false;
    if (bass > bassAvg * 1.25 && bass > 0.3 && t - lastBeat > 250) {
      lastBeat = t;
      beatKick = 1;
      beatCount++;
      onBeat = true;
    }
    beatKick *= 0.86;

    // Surges: a sudden jump in loudness (drop, big chorus) after a few calm seconds.
    if (mid > slow * 1.5 && mid > 0.25 && t - lastWow > 6000 && songTime > 4) {
      lastWow = t;
      wow = 1;
    }
    wow *= 0.97;

    // Singing vs. instrumental: the mouth follows the voice band.
    const singing = voice > 0.14;
    const open = singing ? Math.min(1, (voice - 0.12) * 2.6) : 0;

    // ----- face -----
    ease("open", open, 0.45);
    // Intense moments: eyes squeeze shut for soulful styles, widen for hype styles.
    const soulful = m.tilt < 0;
    let lid = m.lid + (soulful ? energy * 0.35 : -energy * 0.1);
    lid -= wow * 0.5;
    // Natural blinks.
    if (t > blinkAt) blinkAt = t + 2500 + Math.random() * 3000;
    if (blinkAt - t > 2350 && blinkAt - t < 2500) lid = 1;
    ease("lid", Math.max(0, Math.min(1, lid)), 0.25);
    ease("squint", Math.max(0, m.squint + (m.smile > 0 ? energy * 0.15 : 0) - wow * 0.3), 0.15);
    ease("smile", m.smile + wow * 0.4 - (singing ? open * 0.15 : 0), 0.15);
    ease("brow", m.brow + energy * (m.tilt > 6 ? -2 : 3) + wow * 7 + (onBeat && m.headbang ? -3 : 0), 0.25);
    ease("tilt", m.tilt * (0.6 + energy * 0.6) - wow * 4, 0.2);
    ease("browAsym", (m.browAsym || 0) * (onBeat ? 1.2 : 1), 0.2);
    ease("cheek", 0.45 + Math.max(0, m.smile) * 0.25 + energy * 0.25 + wow * 0.3, 0.1);
    const lx = m.look[0] + Math.sin(t / 1700) * 2;
    const ly = m.look[1] + (m.headbang ? beatKick * 3 : 0);
    ease("lookX", lx, 0.08);
    ease("lookY", ly, 0.08);

    // ----- body -----
    const amp = 0.4 + energy * 0.9;
    const swayWave = Math.sin(phase * Math.PI * 2 * m.swaySpeed);
    let rot = swayWave * m.sway * amp + (m.lean || 0) * Math.sin(phase * Math.PI * 0.25);
    let x = m.hips ? swayWave * m.hips * amp : 0;
    let y = -beatKick * m.bounce * amp;
    let sx = 1 + beatKick * 0.03 * amp;
    let sy = 1 - beatKick * 0.04 * amp;
    if (m.headbang) {
      // Rock: a hard forward dip on each beat.
      y += beatKick * 6 * energy;
      rot += beatKick * 4 * energy * (beatCount % 2 ? 1 : -1);
    }
    if (m.jump && energy > 0.7) y -= beatKick * m.jump * (energy - 0.5) * 2;
    // Surge: a big happy hop.
    y -= Math.sin(Math.min(1, (1 - wow) * 3) * Math.PI) * 18 * (wow > 0.05 ? 1 : 0);
    // Calm passages (quiet, no voice): gentle vibe only.
    if (!singing && energy < 0.3) rot *= 0.6;
    // End-of-song bow.
    if (bow > 0.01) {
      const b = Math.sin(bow * Math.PI);
      y += b * 14;
      sy -= b * 0.08;
      rot = rot * (1 - b);
    }
    ease("rot", rot, 0.2);
    ease("x", x, 0.2);
    ease("y", y, 0.35);
    ease("sx", sx, 0.4);
    ease("sy", sy, 0.4);

    // ----- left arm gesture -----
    const beatSwing = Math.sin(phase * Math.PI);
    let arm;
    // Arm angles: negative swings the hand out to the side, positive lifts it up high.
    switch (m.arm) {
      case "wave": arm = -10 + Math.sin(phase * Math.PI) * 18 * amp; break;
      case "pump": arm = -35 + beatKick * 45 * amp; break; // fist pump on the beat
      case "raise": arm = 10 + energy * 6 + Math.sin(phase * Math.PI * 0.5) * 5; break; // hand up to the sky
      case "point": arm = -42 + beatKick * 14; break; // points at you on the beat
      case "dance": arm = -12 + beatSwing * 22 * amp; break;
      case "feel": arm = -32 + energy * 22 + Math.sin(phase * Math.PI * 0.25) * 6; break; // reaching out, feeling it
      case "rock": arm = -18 + Math.sin(phase * Math.PI * 0.5) * 6; break;
      default: arm = 0;
    }
    if (wow > 0.3) arm = 14; // arm up for the big moment
    if (bow > 0.01) arm = -45 * Math.sin(bow * Math.PI);
    ease("arm", arm, 0.2);
    ease("mic", singing ? open : 0, 0.3);

    drawFace();
    drawBody();
    return { onBeat, energy, wow };
  }

  // Back to a relaxed, neutral face (paused or idle).
  function relax() {
    Object.assign(st, { open: 0, lid: 0, squint: 0, smile: 0.15, brow: 0, tilt: 0, browAsym: 0, cheek: 0.55, lookX: 0, lookY: 0 });
    drawFace();
    el.body.style.transform = "";
    el.armL.style.transform = "";
    el.holdR.style.transform = "";
    el.lidTopL.style.transform = el.lidTopR.style.transform = "";
    el.lidBotL.style.transform = el.lidBotR.style.transform = "";
    el.looks.forEach((g) => (g.style.transform = ""));
  }

  // A happy bow when the song ends.
  function takeABow(done) {
    const start = performance.now();
    bow = 0.001;
    const step = (t) => {
      const p = (t - start) / 1400;
      if (p >= 1) {
        bow = 0;
        relax();
        if (done) done();
        return;
      }
      bow = p;
      wow = 0;
      st.smile += (1 - st.smile) * 0.2;
      st.squint += (0.6 - st.squint) * 0.2;
      st.lid += (0.3 - st.lid) * 0.2;
      st.open += (0 - st.open) * 0.3;
      st.cheek = 1;
      const b = Math.sin(p * Math.PI);
      st.y = b * 14;
      st.sy = 1 - b * 0.08;
      st.rot *= 0.8;
      st.arm += (-45 * b - st.arm) * 0.3;
      drawFace();
      drawBody();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function setGenre(g) {
    mood = MOODS[g] || MOODS.pop;
    peak = 0.25;
    slow = mid = fast = 0;
    lastWow = lastBeat = -1e9;
    bassAvg = beatKick = wow = 0;
  }

  window.Spud = { perform, relax, takeABow, setGenre, moods: MOODS, get mood() { return mood; } };
})();
