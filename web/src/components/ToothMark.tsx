import { useId } from 'react'

/** The Dentano mark: a D with a tooth cut out of it and an AI sparkle. Used wherever a clinic has no logo of its own. */
export function ToothMark({ className }: { className?: string }) {
  const id = `dg${useId().replace(/:/g, '')}`
  return (
    <svg className={className} viewBox="196 276 336 324" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="200" y1="595" x2="494" y2="400">
          <stop offset="0" stopColor="#1a3de6" />
          <stop offset=".5" stopColor="#0a7dff" />
          <stop offset="1" stopColor="#00d4ff" />
        </linearGradient>
      </defs>
      <path d="M211 323H358A136 136 0 0 1 358 595H211Q200 595 200 584V334Q200 323 211 323Z" fill={`url(#${id})`} />
      <path fill="#fff" d="M247 434C247 406 266 391 290 391C312 391 323 405 342 405S372 391 394 391C418 391 437 406 437 434C437 470 416 524 402 552C398 561 389 561 386 552C378 526 368 488 342 488S306 526 298 552C295 561 286 561 282 552C267 521 247 480 247 434Z" />
      <path fill="#14c8f5" d="M486 281C490 301 496 313 528 323C496 333 490 345 486 365C482 345 476 333 444 323C476 313 482 301 486 281Z" />
    </svg>
  )
}
