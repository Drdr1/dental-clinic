// An anatomical tooth for the chart: a side view (crown, roots, pulp, gum line)
// and the biting surface seen from above. Drawn for an upper tooth with the
// crown at the bottom; lower teeth are the same drawing turned over.

export type ToothStatus = 'healthy' | 'done' | 'progress' | 'planned' | 'existing'
export type ToothKind = 'none' | 'filling' | 'root_canal' | 'crown' | 'implant' | 'missing'

type Shape = {
  w: number          // crown width in a 50-wide box
  roots: 1 | 2 | 3
  apex: number       // how high the roots reach (smaller = longer)
  edge: 'flat' | 'cusp' | 'premolar' | 'molar'
  occ: 'incisor' | 'canine' | 'premolar' | 'molar'
}

// FDI tooth number → its shape. Upper first premolars have two roots,
// upper molars three, lower molars two.
function shapeOf(n: number): Shape {
  const upper = n < 30
  const t = n % 10
  if (t === 1) return upper ? { w: 40, roots: 1, apex: 14, edge: 'flat', occ: 'incisor' } : { w: 30, roots: 1, apex: 16, edge: 'flat', occ: 'incisor' }
  if (t === 2) return upper ? { w: 34, roots: 1, apex: 18, edge: 'flat', occ: 'incisor' } : { w: 32, roots: 1, apex: 14, edge: 'flat', occ: 'incisor' }
  if (t === 3) return { w: upper ? 38 : 36, roots: 1, apex: upper ? 2 : 6, edge: 'cusp', occ: 'canine' }
  if (t === 4) return { w: upper ? 38 : 37, roots: upper ? 2 : 1, apex: 12, edge: 'premolar', occ: 'premolar' }
  if (t === 5) return { w: upper ? 37 : 38, roots: 1, apex: 12, edge: 'premolar', occ: 'premolar' }
  const w = t === 8 ? 44 : 49
  const apex = t === 6 ? 18 : t === 7 ? 22 : 30
  return { w, roots: upper ? 3 : 2, apex, edge: 'molar', occ: 'molar' }
}

const CX = 25        // centre of the 50-wide box
const CEJ = 90       // where crown meets root: the gum line
const H = 150        // biting edge

type P = [number, number]
const pt = ([x, y]: P) => `${x.toFixed(1)} ${y.toFixed(1)}`
const c = (a: P, b: P, e: P) => ` C ${pt(a)} ${pt(b)} ${pt(e)}`
const q = (a: P, e: P) => ` Q ${pt(a)} ${pt(e)}`

/** Crown: from the left neck down to the biting edge and back up to the right neck. */
function crownSides(s: Shape) {
  const n = s.w * (s.edge === 'molar' ? 0.4 : 0.34)
  const m = s.w / 2
  const e = s.w * (s.edge === 'flat' ? 0.44 : s.edge === 'molar' ? 0.46 : 0.4)
  const right = c([CX + m, CEJ + 8], [CX + m + 0.5, H - 26], [CX + e, H - 5])
  let edge: string
  if (s.edge === 'flat') edge = q([CX, H + 1], [CX - e, H - 5])
  else if (s.edge === 'cusp') edge = q([CX + e * 0.45, H - 1], [CX, H + 3]) + q([CX - e * 0.45, H - 1], [CX - e, H - 5])
  else if (s.edge === 'premolar') edge = q([CX + e * 0.6, H + 1], [CX + e * 0.1, H - 1]) + q([CX - e * 0.5, H + 2], [CX - e, H - 5])
  else edge = q([CX + e * 0.7, H + 2], [CX + e * 0.25, H - 2]) + q([CX, H - 5], [CX - e * 0.25, H - 2]) + q([CX - e * 0.7, H + 2], [CX - e, H - 5])
  const left = c([CX - m - 0.5, H - 26], [CX - m, CEJ + 8], [CX - n, CEJ])
  return { n, path: right + edge + left }
}

function rootXs(s: Shape, n: number): number[] {
  if (s.roots === 1) return [CX]
  if (s.roots === 2) return [CX - n * 0.58, CX + n * 0.58]
  return [CX - n * 0.72, CX + n * 0.05, CX + n * 0.72]
}

/** The whole tooth outline, roots included. */
function outline(s: Shape) {
  const { n, path: crown } = crownSides(s)
  const xs = rootXs(s, n)
  const rw = s.roots === 1 ? n * 1.05 : n * 0.5
  const fy = CEJ - 22  // where roots split
  let d = `M ${pt([CX - n, CEJ])}`
  xs.forEach((x, i) => {
    const ay = s.apex + (s.roots === 3 && i === 1 ? 10 : 0)
    if (i === 0) d += c([CX - n - 1, CEJ - 34], [x - rw, ay + 26], [x - 2.4, ay + 2])
    else {
      const f = (xs[i - 1] + x) / 2
      d += c([f, fy - 10], [x - rw * 0.7, ay + 22], [x - 2.4, ay + 2])
    }
    d += q([x, ay - 1.5], [x + 2.4, ay + 2])
    if (i < xs.length - 1) {
      const f = (x + xs[i + 1]) / 2
      d += c([x + rw * 0.7, ay + 22], [f, fy - 10], [f, fy])
    } else {
      d += c([x + rw, ay + 26], [CX + n + 1, CEJ - 34], [CX + n, CEJ])
    }
  })
  return d + crown + ' Z'
}

/** Just the crown, closed along a slightly curved gum line. */
function crownOnly(s: Shape) {
  const { n, path } = crownSides(s)
  return `M ${pt([CX + n, CEJ])}` + path + q([CX, CEJ - 5], [CX + n, CEJ]) + ' Z'
}

/** The nerve: a chamber in the crown and a canal into each root. */
function pulp(s: Shape) {
  const n = s.w * (s.edge === 'molar' ? 0.4 : 0.34)
  const xs = rootXs(s, n)
  const top = CEJ + (s.edge === 'molar' ? 12 : 14)
  const hw = s.edge === 'molar' ? n * 0.5 : n * 0.26
  const chamber = `M ${pt([CX - hw, CEJ - 6])}` + q([CX - hw - 1, top], [CX, top + 3]) + q([CX + hw + 1, top], [CX + hw, CEJ - 6]) + ' Z'
  const canals = xs.map((x, i) => {
    const ay = s.apex + (s.roots === 3 && i === 1 ? 10 : 0) + 7
    return `M ${pt([CX + (x - CX) * 0.4, CEJ - 4])}` + q([x, (CEJ + ay) / 2], [x, ay])
  })
  return { chamber, canals }
}

/** Biting surface seen from above. */
function occlusal(s: Shape) {
  const w = s.w * (s.occ === 'molar' ? 0.98 : 0.92)
  const rx = w / 2
  const ry = s.occ === 'incisor' ? rx * 0.72 : s.occ === 'canine' ? rx * 0.9 : s.occ === 'premolar' ? rx * 0.88 : rx * 0.92
  const cy = 25
  if (s.occ === 'molar') {
    // A rounded square with a little bulge, like a real molar from above.
    return `M ${pt([CX - rx + 4, cy - ry])}` + q([CX, cy - ry - 2], [CX + rx - 3, cy - ry + 1]) + q([CX + rx + 1, cy - ry + 1], [CX + rx, cy])
      + q([CX + rx + 1, cy + ry - 1], [CX + rx - 4, cy + ry]) + q([CX, cy + ry + 2], [CX - rx + 3, cy + ry - 1])
      + q([CX - rx - 1, cy + ry - 2], [CX - rx, cy]) + q([CX - rx - 1, cy - ry], [CX - rx + 4, cy - ry]) + ' Z'
  }
  return `M ${pt([CX - rx, cy])}` + c([CX - rx, cy - ry * 1.05], [CX + rx, cy - ry * 1.05], [CX + rx, cy])
    + c([CX + rx, cy + ry * 1.05], [CX - rx, cy + ry * 1.05], [CX - rx, cy]) + ' Z'
}

function fissure(s: Shape) {
  const r = s.w * 0.22
  if (s.occ === 'molar') return `M ${pt([CX - r, 23])}` + q([CX, 28], [CX + r, 23]) + ` M ${pt([CX, 15])} L ${pt([CX, 35])}`
  if (s.occ === 'premolar') return `M ${pt([CX - r * 0.8, 25])}` + q([CX, 27], [CX + r * 0.8, 25])
  return ''
}

/** An implant: a threaded post where the roots were. */
function implantPost(s: Shape) {
  const top = CEJ
  const bottom = s.apex + 14
  const hw = 5
  const threads: string[] = []
  for (let y = top - 8; y > bottom + 4; y -= 7) threads.push(`M ${pt([CX - hw - 1.5, y])} L ${pt([CX + hw + 1.5, y - 3])}`)
  return {
    post: `M ${pt([CX - hw, top])} L ${pt([CX - hw, bottom + 6])}` + q([CX, bottom - 2], [CX + hw, bottom + 6]) + ` L ${pt([CX + hw, top])} Z`,
    threads: threads.join(' '),
  }
}

export function ToothSide({ n, status, kind }: { n: number; status: ToothStatus; kind: ToothKind }) {
  const s = shapeOf(n)
  const upper = n < 30
  const flip = upper ? undefined : `translate(0 ${H + 4}) scale(1 -1)`
  const p = pulp(s)
  const implant = kind === 'implant' ? implantPost(s) : null
  return (
    <svg className={`tf tf-side st-${status} k-${kind}`} viewBox={`0 0 50 ${H + 4}`} aria-hidden="true">
      <g transform={flip}>
        {implant ? (
          <>
            <path className="tf-implant" d={implant.post} />
            <path className="tf-thread" d={implant.threads} />
            <path className="tf-crown" d={crownOnly(s)} />
          </>
        ) : (
          <>
            <path className="tf-body" d={outline(s)} />
            <path className="tf-crown" d={crownOnly(s)} />
            <path className="tf-pulp" d={p.chamber} />
            {p.canals.map((d, i) => <path key={i} className="tf-canal" d={d} />)}
          </>
        )}
        <path className="tf-gum" d={`M 0 ${CEJ - 2} Q ${CX} ${CEJ - 8} 50 ${CEJ - 2}`} />
        {kind === 'filling' && <circle className="tf-mark" cx={CX} cy={H - 22} r={4} />}
      </g>
    </svg>
  )
}

export function ToothTop({ n, status, kind }: { n: number; status: ToothStatus; kind: ToothKind }) {
  const s = shapeOf(n)
  const f = fissure(s)
  return (
    <svg className={`tf tf-top st-${status} k-${kind}`} viewBox="0 0 50 50" aria-hidden="true">
      <path className="tf-occ" d={occlusal(s)} />
      {f && <path className="tf-fissure" d={f} />}
      {kind === 'filling' && <circle className="tf-mark" cx={CX} cy={25} r={3.6} />}
    </svg>
  )
}
