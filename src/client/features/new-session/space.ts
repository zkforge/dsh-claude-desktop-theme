import type { HeroRippleImpulse, HeroSpaceRenderer } from '../../contracts/hero-canvas.ts';
import { astronautAtlas, astronautFrame, ASTRONAUT_WIDTH, ASTRONAUT_HEIGHT } from './astronaut.ts';
import { createSpaceField, SPACING } from './space-field.ts';

interface Shot { x: number; y: number; vx: number; vy: number; life: number }

export function createHeroSpace(): HeroSpaceRenderer {
  const seed = (Math.random() * 0xffffffff) | 0;
  const shots = new WeakMap<HeroRippleImpulse, Shot>();
  // The feature outlives the hero DOM when the conversation switches to chat.
  const surfaces = new WeakMap<HTMLCanvasElement, {
    width: number; height: number; atlas: HTMLCanvasElement; field: ReturnType<typeof createSpaceField>;
  }>();
  let dark: boolean | undefined, ink = '', shotInk = '';
  let x = .5, y = .58, vx = 0, vy = 0, tilt = 0, previous = 0;

  return { draw(canvas, title, elapsed, clicks, pointer) {
    const ctx = canvas.getContext('2d')!;
    const caption = title?.height ? title.getContext('2d') : null;
    const ratio = Math.min(canvas.ownerDocument.defaultView!.devicePixelRatio || 1, 2);
    const top = (title?.height ?? 0) / ratio;
    const heroHeight = canvas.height / ratio;
    const width = canvas.width / ratio, height = heroHeight + top;
    let surface = surfaces.get(canvas);
    if (!surface || width !== surface.width || height !== surface.height) {
      if (!surface) {
        x = .5; y = .58; vx = vy = tilt = previous = 0;
      }
      surface = { width, height, atlas: surface?.atlas ?? astronautAtlas(canvas.ownerDocument),
        field: createSpaceField(width, height, seed) };
      surfaces.set(canvas, surface);
    }
    const { field, atlas } = surface;
    const isDark = canvas.ownerDocument.body.hasAttribute('data-ds-dark-theme');
    if (isDark !== dark) {
      dark = isDark;
      const style = getComputedStyle(canvas);
      ink = style.getPropertyValue('--ccd-hero-space-dot').trim();
      shotInk = style.getPropertyValue('--ccd-hero-space-shot').trim();
    }
    const t = elapsed / 1000, dt = Math.min(.05, Math.max(.008, t - previous));
    previous = t;
    const targetX = pointer ? Math.max(.1, Math.min(.9, pointer.x)) : .5;
    const targetY = pointer ? Math.max(.12, Math.min(.88, (pointer.y * heroHeight + top) / height)) : .58;
    vx += (.12 * (targetX + .028 * Math.sin(.45 * t) + .018 * Math.sin(.19 * t + 1.7) - x) - .8 * vx) * dt;
    vy += (.12 * (targetY + .045 * Math.sin(.62 * t + .8) + .03 * Math.sin(.27 * t + 2.4) - y) - .8 * vy) * dt;
    x += vx * dt; y += vy * dt;
    tilt += (Math.max(-8, Math.min(8, 55 * vx)) - tilt) * (1 - Math.exp(-4 * dt));
    const petX = x * width, petY = y * height;

    // Both canvases use scene coordinates so the sky continues into the native caption.
    ctx.setTransform(ratio, 0, 0, ratio, 0, -top * ratio);
    ctx.clearRect(0, top, width, heroHeight);
    if (caption) {
      caption.setTransform(ratio, 0, 0, ratio, 0, 0);
      caption.clearRect(0, 0, width, top);
    }
    const plot = (px: number, py: number, r: number) => {
      if (py + r > top) {
        ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, 2 * Math.PI);
      }
      if (caption && py - r < top) {
        caption.moveTo(px + r, py); caption.arc(px, py, r, 0, 2 * Math.PI);
      }
    };
    ctx.globalAlpha = .7; ctx.fillStyle = ink; ctx.beginPath();
    if (caption) { caption.globalAlpha = .7; caption.fillStyle = ink; caption.beginPath(); }
    field(t, petX, petY, plot);
    ctx.fill(); caption?.fill();

    if (clicks.length) {
      ctx.fillStyle = shotInk; ctx.beginPath();
      if (caption) { caption.fillStyle = shotInk; caption.beginPath(); }
      for (const click of clicks) {
        let shot = shots.get(click);
        if (!shot) {
          const speed = 400 + 220 * Math.random(), incoming = Math.random() < .75;
          const direction = Math.random() < .5 ? 1 : -1;
          const clickX = click.x * width, clickY = top + click.y * heroHeight;
          const startX = incoming ? (direction > 0 ? -40 : width + 40) : clickX;
          const distance = Math.abs(startX - clickX);
          let angle = (28 + 27 * Math.random()) * Math.PI / 180;
          if (incoming && clickY - distance * Math.tan(angle) < 10) {
            angle = Math.max(Math.PI / 15, Math.atan((clickY - 10) / distance));
          }
          shot = { x: startX, y: clickY - distance * Math.tan(angle),
            vx: direction * speed * Math.cos(angle), vy: speed * Math.sin(angle), life: incoming ? 2.4 : 1.6 };
          shots.set(click, shot);
        }
        const age = (elapsed - click.startedAt) / 1000;
        if (age >= shot.life) continue;
        const fade = Math.min(1, age / (.25 * shot.life)) * Math.min(1, (shot.life - age) / (.4 * shot.life));
        const speed = Math.hypot(shot.vx, shot.vy);
        const originX = (width % SPACING + SPACING) / 2, originY = (height % SPACING + SPACING) / 2;
        for (let i = 0; i < 9; i++) {
          const at = age - SPACING * i / speed;
          const px = originX + SPACING * Math.round((shot.x + shot.vx * at - originX) / SPACING);
          const py = originY + SPACING * Math.round((shot.y + shot.vy * at - originY) / SPACING);
          const r = SPACING * (i ? .15 * (1 - i / 12) : .267) * fade;
          if (r < .4 || (Math.abs(px - petX) < ASTRONAUT_WIDTH / 2 + SPACING && Math.abs(py - petY) < ASTRONAUT_HEIGHT / 2 + SPACING)) continue;
          plot(px, py, r);
        }
      }
      ctx.fill(); caption?.fill();
    }

    const pose = astronautFrame(t) * 40;
    const paintPet = (surface: CanvasRenderingContext2D) => {
      surface.save();
      surface.globalAlpha = Math.min(1, t / 1.4);
      surface.imageSmoothingEnabled = false;
      surface.translate(petX, petY);
      surface.rotate(tilt * Math.PI / 180);
      surface.translate(0, 4 * Math.sin(1.1 * t));
      surface.drawImage(atlas, pose, 0, 40, 33,
        -ASTRONAUT_WIDTH / 2, -ASTRONAUT_HEIGHT / 2, ASTRONAUT_WIDTH, ASTRONAUT_HEIGHT);
      surface.restore();
    };
    paintPet(ctx);
    if (caption && petY - 60 < top) paintPet(caption);
  } };
}
