import { describe, expect, it } from 'vitest'
import { findSoundStart } from './audio.ts'

const RATE = 8000

/** Signal : `silence` secondes de (quasi) silence, puis une sinusoïde. */
function signal(silence: number, total = 6, amplitude = 0.5, noise = 0.0005): Float32Array {
  const data = new Float32Array(total * RATE)
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    data[i] = (Math.random() - 0.5) * noise + (t >= silence ? amplitude * Math.sin(2 * Math.PI * 440 * t) : 0)
  }
  return data
}

describe('findSoundStart', () => {
  it('saute le silence du début', () => {
    expect(findSoundStart([signal(3)], RATE)).toBeCloseTo(2.95, 1)
  })

  it('ne touche à rien si le son commence tout de suite', () => {
    expect(findSoundStart([signal(0)], RATE)).toBe(0)
  })

  it("repère un début doux (morceau calme)", () => {
    expect(findSoundStart([signal(1.5, 6, 0.03)], RATE)).toBeCloseTo(1.45, 1)
  })

  it('ne saute jamais plus de 10 secondes', () => {
    expect(findSoundStart([signal(14, 20)], RATE)).toBe(10)
  })

  it('renvoie 0 pour un fichier entièrement silencieux', () => {
    expect(findSoundStart([new Float32Array(RATE)], RATE)).toBe(0)
  })
})
