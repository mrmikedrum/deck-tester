// A card's back: the tome's own leather, blind-tooled with a double rule, and a bronze rosette riveted at its heart.
import { FACE_H, FACE_W } from "./face-size";
import { rr } from "./shapes";
import type { Ctx } from "./shapes";
import { bronzeColour, pattern } from "./surfaces";
import type { Surfaces } from "./surfaces";

export function drawBack(x: Ctx, s: Surfaces): void {
  const FW = FACE_W,
    FH = FACE_H;
  x.clearRect(0, 0, FW, FH);
  rr(x, 4, 4, FW - 8, FH - 8, 16);
  x.fillStyle = "#2a170c";
  x.fill();
  x.save();
  rr(x, 4, 4, FW - 8, FH - 8, 16);
  x.clip();
  if (s.tome) {
    x.globalAlpha = 0.55;
    x.drawImage(s.tome, 0, 0, FW * 1.6, FH * 1.6);
    x.globalAlpha = 1;
  }
  const sh = x.createRadialGradient(FW / 2, FH * 0.45, 30, FW / 2, FH / 2, FH * 0.62);
  sh.addColorStop(0, "rgba(120,70,30,.18)");
  sh.addColorStop(1, "rgba(0,0,0,.55)");
  x.fillStyle = sh;
  x.fillRect(0, 0, FW, FH);
  x.restore();
  rr(x, 4, 4, FW - 8, FH - 8, 16);
  x.lineWidth = 3;
  x.strokeStyle = "rgba(10,5,2,.9)";
  x.stroke();
  // Blind tooling: a pressed rule (dark) with its lit lip, twice.
  for (const [o, r] of [
    [24, 10],
    [36, 7],
  ] as const) {
    rr(x, o, o + 1.5, FW - 2 * o, FH - 2 * o, r);
    x.lineWidth = 2;
    x.strokeStyle = "rgba(255,210,150,.16)";
    x.stroke();
    rr(x, o, o, FW - 2 * o, FH - 2 * o, r);
    x.lineWidth = 2.5;
    x.strokeStyle = "rgba(8,4,1,.7)";
    x.stroke();
  }
  // The rosette: eight bronze petals round a domed boss.
  const cx = FW / 2,
    cy = FH / 2,
    metal = pattern(x, s.bronzeClean, bronzeColour);
  x.save();
  x.translate(cx, cy);
  x.shadowColor = "rgba(0,0,0,.7)";
  x.shadowBlur = 10;
  x.shadowOffsetY = 4;
  x.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    x.moveTo(0, 0);
    x.ellipse(Math.cos(a) * 46, Math.sin(a) * 46, 40, 17, a, 0, Math.PI * 2);
  }
  x.fillStyle = metal;
  x.fill();
  x.shadowColor = "transparent";
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    x.beginPath();
    x.ellipse(Math.cos(a) * 46, Math.sin(a) * 46, 40, 17, a, 0, Math.PI * 2);
    x.lineWidth = 2;
    x.strokeStyle = "rgba(30,16,4,.85)";
    x.stroke();
    x.beginPath();
    x.moveTo(Math.cos(a) * 16, Math.sin(a) * 16);
    x.lineTo(Math.cos(a) * 76, Math.sin(a) * 76);
    x.lineWidth = 1.5;
    x.strokeStyle = "rgba(30,16,4,.5)";
    x.stroke();
  }
  const dome = x.createRadialGradient(-8, -9, 2, 0, 0, 26);
  dome.addColorStop(0, "#f6dca0");
  dome.addColorStop(0.45, "#a8803e");
  dome.addColorStop(1, "#3e2a10");
  x.beginPath();
  x.arc(0, 0, 24, 0, Math.PI * 2);
  x.fillStyle = dome;
  x.fill();
  x.lineWidth = 2.5;
  x.strokeStyle = "#1e1206";
  x.stroke();
  const gl = x.createLinearGradient(0, -24, 0, 24);
  gl.addColorStop(0, "rgba(255,240,200,.35)");
  gl.addColorStop(1, "rgba(0,0,0,.25)");
  x.beginPath();
  x.arc(0, 0, 32, 0, Math.PI * 2);
  x.lineWidth = 3;
  x.strokeStyle = gl;
  x.stroke();
  x.restore();
  // Corner rivets.
  for (const [rx, ry] of [
    [30, 30],
    [FW - 30, 30],
    [30, FH - 30],
    [FW - 30, FH - 30],
  ] as const) {
    x.beginPath();
    x.arc(rx, ry, 6, 0, Math.PI * 2);
    x.fillStyle = metal;
    x.fill();
    x.lineWidth = 1.5;
    x.strokeStyle = "#1e1206";
    x.stroke();
  }
}
