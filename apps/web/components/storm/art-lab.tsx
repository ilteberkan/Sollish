'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StormCharacter, type StormCharacterHandle, type StormPose } from './character';
import { StormScene, type StormMood, type StormSceneHandle } from './scene';
import styles from './scene.module.css';

/* Dev-only gallery for the Fırtına Tahtı art (rendered by app/lab/storm-art, notFound in prod). */

const POSES: StormPose[] = ['idle', 'charge', 'strike', 'laugh', 'triumph', 'calm'];
const POSE_TR: Record<StormPose, string> = { idle: 'Bekleme', charge: 'Yükleme', strike: 'Vuruş', laugh: 'Kahkaha', triumph: 'Zafer', calm: 'Sakin' };
const MOODS: Array<[StormMood, string]> = [['base', 'Temel'], ['feature', 'Özellik'], ['bigwin', 'Büyük kazanç']];
const GLYPHS = ['#e9b35d', '#4fb7c9', '#c0563a', '#8fa86a', '#b48ad8', '#e2d6b8'];

const bar: React.CSSProperties = { position: 'absolute', zIndex: 5, left: 8, right: 8, top: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', font: '600 12px/1 var(--font-barlow), system-ui, sans-serif', color: '#e8eef2', pointerEvents: 'auto' };
const btn = (on: boolean): React.CSSProperties => ({ padding: '7px 10px', borderRadius: 8, border: `1px solid ${on ? '#e9b35d' : '#3a5163'}`, background: on ? 'rgba(233,179,93,.22)' : 'rgba(10,20,30,.72)', color: '#eef3f6', cursor: 'pointer', font: 'inherit' });

export function StormArtLab() {
  const [tab, setTab] = useState<'scene' | 'poses'>('scene');
  const [mood, setMood] = useState<StormMood>('base');
  const [pose, setPose] = useState<StormPose>('idle');
  const [auto, setAuto] = useState(false);
  const [hit, setHit] = useState(-1);
  const [fps, setFps] = useState('');
  const scene = useRef<StormSceneHandle>(null);
  const hero = useRef<StormCharacterHandle>(null);
  const cells = useRef<Array<HTMLDivElement | null>>([]);

  const strike = useCallback(async (index?: number) => {
    const i = index ?? Math.floor(Math.random() * 30);
    const cell = cells.current[i];
    if (!cell || !hero.current) return;
    const r = cell.getBoundingClientRect();
    const to = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const from = await hero.current.strike(to);
    if (from) scene.current?.strike(from, to, 1);
    setHit(i);
    window.setTimeout(() => setHit(-1), 420);
  }, []);

  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => { void strike(); }, 1600);
    return () => window.clearInterval(id);
  }, [auto, strike]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = scene.current?.weather?.stats;
      if (s) setFps(`${s.fps.toFixed(0)} fps · ${s.avgMs.toFixed(1)} ms ort · en kötü ${s.worstMs.toFixed(0)} ms · yağmur ${s.drops} · kor ${s.embers}`);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (mood === 'bigwin') { setPose('triumph'); scene.current?.celebrate(1.2); }
  }, [mood]);

  if (tab === 'poses') {
    return (
      <main style={{ position: 'fixed', inset: 0, zIndex: 60, overflow: 'auto', background: '#0b141d', padding: '56px 12px 24px' }}>
        <div style={bar}>
          <button type="button" style={btn(false)} onClick={() => setTab('scene')} data-testid="tab-scene">Sahne</button>
          <span>Pozlar (her biri ayrı örnek)</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {POSES.map((p) => (
            <figure key={p} data-testid={`pose-${p}`} style={{ margin: 0, height: 380, borderRadius: 14, background: 'radial-gradient(ellipse at 50% 30%, #1f3a50, #0a131c 75%)', display: 'grid', gridTemplateRows: '1fr auto', overflow: 'hidden' }}>
              <StormCharacter pose={p} />
              <figcaption style={{ padding: 8, textAlign: 'center', color: '#cfdae2', font: '600 13px var(--font-barlow), sans-serif' }}>{POSE_TR[p]} · {p}</figcaption>
            </figure>
          ))}
          <figure data-testid="bust-large" style={{ margin: 0, gridColumn: '1 / -1', height: 640, borderRadius: 14, background: 'radial-gradient(ellipse at 50% 30%, #1f3a50, #0a131c 75%)', overflow: 'hidden' }}>
            <StormCharacter pose="idle" framing="bust" />
          </figure>
          {(['idle', 'charge'] as StormPose[]).map((p) => (
            <figure key={`b${p}`} data-testid={`bust-${p}`} style={{ margin: 0, height: 260, borderRadius: 14, background: 'radial-gradient(ellipse at 50% 30%, #1f3a50, #0a131c 75%)', display: 'grid', gridTemplateRows: '1fr auto', overflow: 'hidden' }}>
              <StormCharacter pose={p} framing="bust" />
              <figcaption style={{ padding: 8, textAlign: 'center', color: '#cfdae2', font: '600 13px var(--font-barlow), sans-serif' }}>Telefon büstü · {p}</figcaption>
            </figure>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
      <StormScene ref={scene} mood={mood}>
        <div style={bar}>
          <button type="button" style={btn(false)} onClick={() => setTab('poses')} data-testid="tab-poses">Pozlar</button>
          {MOODS.map(([m, l]) => <button key={m} type="button" style={btn(mood === m)} onClick={() => setMood(m)} data-testid={`mood-${m}`}>{l}</button>)}
          {POSES.map((p) => <button key={p} type="button" style={btn(pose === p)} onClick={() => setPose(p)} data-testid={`set-${p}`}>{POSE_TR[p]}</button>)}
          <button type="button" style={btn(false)} onClick={() => void strike()} data-testid="strike">Yıldırım</button>
          <button type="button" style={btn(auto)} onClick={() => setAuto((a) => !a)} data-testid="auto">Otomatik</button>
          <button type="button" style={btn(false)} onClick={() => scene.current?.celebrate(1)} data-testid="celebrate">Kor yağmuru</button>
          <span data-testid="fps" style={{ opacity: 0.8 }}>{fps}</span>
        </div>
        <div className={styles.labStage}>
          <div className={styles.labHero}>
            <StormCharacter ref={hero} pose={pose} framing="auto" />
          </div>
          <div className={styles.labBoard} data-testid="board">
            {Array.from({ length: 30 }, (_, i) => (
              <div key={i} ref={(el) => { cells.current[i] = el; }} className={styles.labCell} data-hit={hit === i || undefined} onClick={() => void strike(i)}>
                <span style={{ background: GLYPHS[(i * 7 + (i >> 2)) % GLYPHS.length] }} />
              </div>
            ))}
          </div>
        </div>
      </StormScene>
    </main>
  );
}
