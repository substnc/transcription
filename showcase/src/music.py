# Enkelt syntspår, 10 s: mjuk pad, bas, plock på händelserna i bilden, lätt rumsklang.
import numpy as np, wave
SR = 48000; N = SR * 10; t = np.arange(N) / SR
f = lambda m: 440 * 2 ** ((m - 69) / 12)
L = np.zeros(N); R = np.zeros(N)
def env(a, b, att, rel):
    e = np.zeros(N); i0, i1 = int(a * SR), min(N, int(b * SR))
    x = t[i0:i1] - a; d = b - a
    e[i0:i1] = np.minimum(1, x / att) * np.minimum(1, np.maximum(0, (d - x) / rel))
    return e
def pad(notes, a, b, g=0.05):
    e = env(a, b, 0.9, 1.0)
    for k, m in enumerate(notes):
        for det, pan in ((-0.12, 0.7), (0.12, 0.3)):
            s = np.sin(2 * np.pi * f(m + det / 12 * 1) * t) + 0.18 * np.sin(4 * np.pi * f(m) * t)
            L[:] += g * e * s * pan; R[:] += g * e * s * (1 - pan)
def bass(m, a, b, g=0.12):
    s = g * env(a, b, 0.25, 0.8) * np.sin(2 * np.pi * f(m) * t)
    L[:] += s; R[:] += s
def pluck(m, at, g=0.13, pan=0.5, dec=1.6):
    i0 = int(at * SR); x = t[i0:] - at
    s = g * np.exp(-x * dec) * np.minimum(1, x / 0.004) * (np.sin(2 * np.pi * f(m) * x) + 0.3 * np.sin(4 * np.pi * f(m) * x) * np.exp(-x * 4))
    L[i0:] += s * (1 - pan) * 2 * 0.5 + s * 0.25; R[i0:] += s * pan * 2 * 0.5 + s * 0.25
def tick(at, g=0.018):
    i0 = int(at * SR); n = int(0.03 * SR); x = np.arange(n) / SR
    s = g * np.random.default_rng(int(at * 1000)).standard_normal(n) * np.exp(-x * 220)
    L[i0:i0 + n] += s; R[i0:i0 + n] += s
# Ackord: Fmaj9, Dm9, Bbmaj9 -> Fadd9
pad([53, 57, 60, 64, 67], 0.0, 3.7)
pad([50, 53, 57, 60, 64], 3.2, 7.0)
pad([46, 50, 53, 57, 60], 6.5, 8.4)
pad([53, 57, 60, 67, 69], 8.1, 10.0, 0.045)
bass(29, 0.0, 3.6); bass(26, 3.3, 6.9); bass(34, 6.6, 8.4); bass(29, 8.2, 10.0)
# Scen 1: en ton när texten klistras in.
pluck(76, 1.9, 0.12); pluck(81, 1.98, 0.09, 0.6)
# Scen 2: en ton per talare och en för sammanfattningen.
for at, m, p in ((3.7, 72, 0.35), (4.15, 76, 0.55), (4.6, 79, 0.65), (5.2, 77, 0.5)): pluck(m, at, 0.1, p)
# Scen 3: namnet och signaturen.
pluck(69, 6.8, 0.12, 0.45); pluck(72, 6.95, 0.08, 0.55); pluck(77, 7.95, 0.08, 0.5); pluck(81, 8.45, 0.07, 0.6, 1.2)
# Rumsklang: några återkopplade fördröjningar.
def verb(x):
    out = np.zeros_like(x)
    for d, fb in ((0.0297, 0.72), (0.0371, 0.7), (0.0411, 0.68), (0.0437, 0.66)):
        n = int(d * SR); y = x.copy()
        for i in range(n, len(y), n): y[i:i + n] += fb * y[i - n:i][: len(y[i:i + n])]
        out += y
    return out / 4
L2 = L + 0.35 * verb(np.roll(L, 480)); R2 = R + 0.35 * verb(np.roll(R, 720))
fade = np.minimum(1, t / 0.08) * np.minimum(1, (10 - t) / 1.2)
st = np.stack([L2, R2], 1) * fade[:, None]
st = st / np.abs(st).max() * 0.7  # ungefär -3 dBFS topp
w = wave.open('music.wav', 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((st * 32767).astype('<i2').tobytes()); w.close()
