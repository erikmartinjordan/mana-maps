// ── globe-hand-variants.js ─ Maña/game-style hand options for the globe-spin demo ──
// Each variant uses the same 900x900 canvas convention as the production hand.
// The `tip` coordinate marks the fingertip contact point used for positioning.

(function () {
  function holoHand() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900">
  <defs>
    <pattern id="mv1Scan" width="10" height="10" patternUnits="userSpaceOnUse">
      <rect x="0" y="4" width="10" height="2" fill="#bae6fd" opacity=".28"/>
    </pattern>
    <linearGradient id="mv1Beam" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7dd3fc" stop-opacity=".55"/>
      <stop offset="1" stop-color="#0ea5e9" stop-opacity=".08"/>
    </linearGradient>
    <filter id="mv1Soft"><feGaussianBlur stdDeviation="8"/></filter>
    <filter id="mv1Wide"><feGaussianBlur stdDeviation="22"/></filter>
    <clipPath id="mv1Body"><path d="M314,520 C312,455 324,410 352,392 C396,365 470,360 532,378 C596,395 642,430 652,490 C660,548 648,628 636,710 C628,775 624,840 624,900 L348,900 C350,840 342,775 336,710 C328,630 314,570 314,520 Z"/></clipPath>
  </defs>

  <ellipse class="gh-contact" cx="566" cy="100" rx="46" ry="10" fill="#06263c" opacity=".3" filter="url(#mv1Soft)"/>
  <ellipse cx="566" cy="92" rx="60" ry="17" fill="#7dd3fc" opacity=".2" filter="url(#mv1Wide)"/>
  <circle cx="566" cy="104" r="54" fill="none" stroke="#7dd3fc" stroke-width="3" opacity=".55"/>
  <path d="M566,38 L566,54 M566,154 L566,170 M500,104 L516,104 M616,104 L632,104" stroke="#7dd3fc" stroke-width="4" stroke-linecap="round" opacity=".7"/>

  <path d="M314,520 C312,455 324,410 352,392 C396,365 470,360 532,378 C596,395 642,430 652,490 C660,548 648,628 636,710 C628,775 624,840 624,900 L348,900 C350,840 342,775 336,710 C328,630 314,570 314,520 Z" fill="#0ea5e9" fill-opacity=".16" stroke="#38bdf8" stroke-width="4" stroke-opacity=".85" stroke-linejoin="round"/>
  <g clip-path="url(#mv1Body)">
    <rect x="300" y="360" width="370" height="540" fill="url(#mv1Scan)"/>
    <polygon points="336,700 380,640 380,900 336,900" fill="#0b1626" opacity=".32"/>
    <polygon points="630,680 600,620 600,900 630,900" fill="#dff3ff" opacity=".18"/>
    <path d="M360,620 L430,590 L470,660 L400,700 Z M510,600 L585,575 L605,650 L530,675 Z" fill="none" stroke="#7dd3fc" stroke-width="3" opacity=".55"/>
  </g>

  <g fill="#0ea5e9" fill-opacity=".13" stroke="#38bdf8" stroke-opacity=".8" stroke-width="3">
    <polygon points="352,520 360,410 392,392 424,410 432,520"/>
    <polygon points="436,520 444,388 478,370 512,388 520,520"/>
    <polygon points="524,520 532,372 566,354 600,372 608,520"/>
  </g>

  <g class="gh-finger">
    <path d="M538,510 C537,420 539,330 545,245 C549,190 553,145 559,124 C561,114 563,108 566,108 C569,108 571,114 573,124 C579,145 583,190 587,245 C593,330 595,420 594,510 Z" fill="#0ea5e9" fill-opacity=".22" stroke="#38bdf8" stroke-opacity=".9" stroke-width="3.5" stroke-linejoin="round"/>
    <polygon points="538,510 545,245 559,124 566,108 573,124 574,260 568,510" fill="#06263c" opacity=".28"/>
    <polygon points="594,510 587,245 573,124 566,108 566,510" fill="#dff3ff" opacity=".18"/>
    <circle cx="566" cy="108" r="7" fill="#e0f2fe"/>
    <circle cx="566" cy="250" r="5" fill="none" stroke="#7dd3fc" stroke-width="3" opacity=".8"/>
    <circle cx="566" cy="345" r="5" fill="none" stroke="#7dd3fc" stroke-width="3" opacity=".8"/>
  </g>

  <g class="gh-thumb">
    <path d="M650,512 C630,484 596,472 556,474 C506,477 452,487 408,497 C386,502 376,516 382,532 C388,548 408,555 432,553 C480,549 532,543 582,538 C620,534 648,523 650,512 Z" fill="#0ea5e9" fill-opacity=".22" stroke="#38bdf8" stroke-opacity=".9" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="430" cy="512" r="6" fill="#e0f2fe"/>
  </g>

  <path d="M360,812 L624,812 L624,900 L360,900 Z" fill="#0b1626" opacity=".92"/>
  <rect x="360" y="812" width="264" height="10" fill="#38bdf8" opacity=".75"/>
  <circle cx="420" cy="856" r="7" fill="#38bdf8"/>
  <circle cx="492" cy="856" r="7" fill="#38bdf8"/>
  <circle cx="564" cy="856" r="7" fill="#38bdf8"/>
</svg>`;
  }

  function pixelHand() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900" shape-rendering="crispEdges">
  <defs>
    <linearGradient id="mv2Skin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f7d9b8"/>
      <stop offset=".55" stop-color="#eda97c"/>
      <stop offset="1" stop-color="#b96f43"/>
    </linearGradient>
    <linearGradient id="mv2Cuff" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#38bdf8"/>
      <stop offset="1" stop-color="#0369a1"/>
    </linearGradient>
  </defs>

  <g class="gh-contact">
    <rect x="540" y="88" width="40" height="8" fill="#2b1307" opacity=".28"/>
    <rect x="532" y="80" width="56" height="8" fill="#bfd9f7" opacity=".25"/>
  </g>

  <g stroke="#3d1c0b" stroke-opacity=".22" stroke-width="4">
    <path d="M336,540 L336,900 L632,900 L632,540 L600,500 L560,486 L430,486 L380,506 Z" fill="url(#mv2Skin)"/>
  </g>
  <rect x="352" y="560" width="264" height="340" fill="#000" opacity=".12"/>
  <rect x="352" y="500" width="264" height="72" fill="#fff" opacity=".18"/>
  <rect x="592" y="540" width="24" height="360" fill="#3d1c0b" opacity=".18"/>

  <g fill="url(#mv2Skin)" stroke="#3d1c0b" stroke-opacity=".2" stroke-width="4">
    <rect x="352" y="360" width="72" height="180"/>
    <rect x="432" y="336" width="72" height="204"/>
    <rect x="512" y="312" width="72" height="228"/>
  </g>
  <g fill="#fff" opacity=".26">
    <rect x="360" y="368" width="16" height="164"/>
    <rect x="440" y="344" width="16" height="188"/>
    <rect x="520" y="320" width="16" height="212"/>
  </g>
  <g fill="#3d1c0b" opacity=".2">
    <rect x="408" y="360" width="16" height="180"/>
    <rect x="488" y="336" width="16" height="204"/>
    <rect x="568" y="312" width="8" height="228"/>
  </g>

  <g class="gh-finger">
    <rect x="528" y="96" width="64" height="444" fill="url(#mv2Skin)" stroke="#3d1c0b" stroke-opacity=".2" stroke-width="4"/>
    <rect x="528" y="96" width="12" height="444" fill="#3d1c0b" opacity=".18"/>
    <rect x="544" y="96" width="12" height="444" fill="#fff" opacity=".28"/>
    <rect x="576" y="96" width="16" height="444" fill="#3d1c0b" opacity=".2"/>
    <rect x="528" y="236" width="64" height="8" fill="#3d1c0b" opacity=".22"/>
    <rect x="528" y="244" width="64" height="4" fill="#fff" opacity=".24"/>
    <rect x="528" y="348" width="64" height="8" fill="#3d1c0b" opacity=".22"/>
    <rect x="528" y="356" width="64" height="4" fill="#fff" opacity=".24"/>
    <rect x="540" y="104" width="16" height="12" fill="#fff" opacity=".55"/>
  </g>

  <g class="gh-thumb">
    <rect x="376" y="472" width="264" height="72" fill="url(#mv2Skin)" stroke="#3d1c0b" stroke-opacity=".2" stroke-width="4"/>
    <rect x="376" y="472" width="264" height="12" fill="#fff" opacity=".25"/>
    <rect x="376" y="524" width="264" height="20" fill="#3d1c0b" opacity=".18"/>
    <rect x="440" y="480" width="8" height="56" fill="#3d1c0b" opacity=".2"/>
    <rect x="556" y="480" width="8" height="56" fill="#3d1c0b" opacity=".2"/>
  </g>

  <rect x="360" y="790" width="260" height="70" fill="url(#mv2Cuff)"/>
  <rect x="360" y="790" width="260" height="12" fill="#fff" opacity=".3"/>
  <rect x="392" y="816" width="12" height="12" fill="#fff" opacity=".8"/>
  <rect x="464" y="816" width="12" height="12" fill="#fff" opacity=".8"/>
  <rect x="536" y="816" width="12" height="12" fill="#fff" opacity=".8"/>
  <rect x="548" y="64" width="8" height="8" fill="#0ea5e9"/>
  <rect x="572" y="48" width="8" height="8" fill="#0ea5e9"/>
</svg>`;
  }

  function mechaHand() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900">
  <defs>
    <linearGradient id="mv3Plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3b465c"/>
      <stop offset=".55" stop-color="#232c3d"/>
      <stop offset="1" stop-color="#111724"/>
    </linearGradient>
    <linearGradient id="mv3Edge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#0ea5e9" stop-opacity="0"/>
      <stop offset=".5" stop-color="#7dd3fc" stop-opacity=".75"/>
      <stop offset="1" stop-color="#0ea5e9" stop-opacity="0"/>
    </linearGradient>
    <filter id="mv3Soft"><feGaussianBlur stdDeviation="8"/></filter>
    <filter id="mv3Wide"><feGaussianBlur stdDeviation="22"/></filter>
  </defs>

  <ellipse class="gh-contact" cx="572" cy="104" rx="44" ry="10" fill="#020617" opacity=".38" filter="url(#mv3Soft)"/>
  <ellipse cx="572" cy="96" rx="62" ry="17" fill="#38bdf8" opacity=".24" filter="url(#mv3Wide)"/>

  <path d="M322,548 C320,476 334,424 366,406 C414,380 486,376 548,392 C608,407 652,442 660,502 C667,558 655,638 643,718 C635,780 631,840 631,900 L339,900 C341,840 333,774 327,708 C320,634 314,592 322,548 Z" fill="url(#mv3Plate)" stroke="#0b1220" stroke-opacity=".72" stroke-width="4" stroke-linejoin="round"/>
  <path d="M360,540 L430,500 L470,570 L400,610 Z M480,540 L560,505 L600,575 L520,610 Z" fill="#0b1220" opacity=".34"/>
  <path d="M352,600 L618,600 M348,700 L622,700" stroke="#38bdf8" stroke-width="4" opacity=".34"/>

  <g fill="url(#mv3Plate)" stroke="#0b1220" stroke-opacity=".68" stroke-width="4">
    <rect x="344" y="392" width="88" height="140" rx="18"/>
    <rect x="440" y="366" width="90" height="150" rx="18"/>
    <rect x="534" y="342" width="90" height="158" rx="18"/>
  </g>
  <g stroke="#38bdf8" stroke-width="4" opacity=".55">
    <line x1="360" y1="430" x2="416" y2="430"/>
    <line x1="456" y1="406" x2="514" y2="406"/>
    <line x1="550" y1="382" x2="608" y2="382"/>
  </g>
  <g fill="#9fb4cc">
    <circle cx="368" cy="462" r="5"/><circle cx="404" cy="462" r="5"/>
    <circle cx="464" cy="438" r="5"/><circle cx="502" cy="438" r="5"/>
    <circle cx="558" cy="414" r="5"/><circle cx="596" cy="414" r="5"/>
  </g>

  <g class="gh-finger">
    <path d="M540,520 L540,360 L546,220 L552,152 L560,122 L566,112 L578,112 L586,124 L592,154 L598,226 L604,360 L606,520 Z" fill="url(#mv3Plate)" stroke="#0b1220" stroke-opacity=".7" stroke-width="4" stroke-linejoin="round"/>
    <path d="M540,360 L606,360 M542,460 L606,460" stroke="#38bdf8" stroke-width="5" opacity=".62"/>
    <rect x="562" y="124" width="18" height="150" fill="#dff3ff" opacity=".28"/>
    <rect x="592" y="220" width="10" height="220" fill="#020617" opacity=".22"/>
    <circle cx="573" cy="112" r="12" fill="#38bdf8"/>
    <circle cx="573" cy="112" r="6" fill="#e0f2fe"/>
  </g>

  <g class="gh-thumb">
    <path d="M656,512 L620,474 L568,468 L470,480 L402,492 L378,508 L382,538 L408,554 L470,548 L570,538 L632,530 Z" fill="url(#mv3Plate)" stroke="#0b1220" stroke-opacity=".7" stroke-width="4" stroke-linejoin="round"/>
    <path d="M430,492 L430,542 M530,484 L530,538 M610,478 L610,530" stroke="#38bdf8" stroke-width="5" opacity=".6"/>
    <circle cx="412" cy="518" r="6" fill="#9fb4cc"/>
    <circle cx="628" cy="504" r="6" fill="#9fb4cc"/>
  </g>

  <polygon points="408,812 428,812 418,830" fill="#38bdf8" opacity=".8"/>
  <polygon points="484,812 504,812 494,830" fill="#38bdf8" opacity=".8"/>
  <polygon points="560,812 580,812 570,830" fill="#38bdf8" opacity=".8"/>
</svg>`;
  }

  function mascotHand() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900">
  <defs>
    <radialGradient id="mv4Glove" gradientUnits="userSpaceOnUse" cx="410" cy="420" r="560">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset=".55" stop-color="#f5f7fa"/>
      <stop offset="1" stop-color="#cbd5e1"/>
    </radialGradient>
    <linearGradient id="mv4Cuff" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#38bdf8"/>
      <stop offset="1" stop-color="#0369a1"/>
    </linearGradient>
    <filter id="mv4Soft"><feGaussianBlur stdDeviation="10"/></filter>
    <filter id="mv4Wide"><feGaussianBlur stdDeviation="24"/></filter>
    <clipPath id="mv4Palm"><path d="M312,560 C312,485 330,435 368,418 C418,395 492,392 552,410 C612,428 648,470 652,535 C655,605 642,685 634,755 C628,810 626,855 626,900 L338,900 C340,845 332,785 326,725 C320,655 310,610 312,560 Z"/></clipPath>
  </defs>

  <ellipse class="gh-contact" cx="556" cy="110" rx="43" ry="10" fill="#0f172a" opacity=".26" filter="url(#mv4Soft)"/>
  <ellipse cx="556" cy="102" rx="60" ry="17" fill="#bae6fd" opacity=".32" filter="url(#mv4Wide)"/>
  <path d="M500,36 L508,58 L531,58 L512,72 L519,94 L500,80 L481,94 L488,72 L469,58 L492,58 Z" fill="#38bdf8" opacity=".85"/>

  <path d="M312,560 C312,485 330,435 368,418 C418,395 492,392 552,410 C612,428 648,470 652,535 C655,605 642,685 634,755 C628,810 626,855 626,900 L338,900 C340,845 332,785 326,725 C320,655 310,610 312,560 Z" fill="url(#mv4Glove)" stroke="#1e293b" stroke-opacity=".72" stroke-width="7" stroke-linejoin="round"/>
  <g clip-path="url(#mv4Palm)">
    <ellipse cx="590" cy="720" rx="165" ry="180" fill="#0ea5e9" opacity=".18" filter="url(#mv4Wide)"/>
    <ellipse cx="410" cy="520" rx="130" ry="115" fill="#fff" opacity=".45" filter="url(#mv4Wide)"/>
  </g>

  <g fill="url(#mv4Glove)" stroke="#1e293b" stroke-opacity=".68" stroke-width="7">
    <rect x="330" y="390" width="96" height="152" rx="46"/>
    <rect x="434" y="364" width="98" height="162" rx="47"/>
    <rect x="536" y="340" width="98" height="172" rx="47"/>
  </g>

  <g class="gh-finger">
    <path d="M522,530 C520,430 522,330 530,235 C534,185 539,145 546,128 C550,114 553,110 556,110 C559,110 562,114 566,128 C573,145 578,185 582,235 C590,330 592,430 590,530 Z" fill="url(#mv4Glove)" stroke="#1e293b" stroke-opacity=".68" stroke-width="7" stroke-linejoin="round"/>
    <ellipse cx="554" cy="250" rx="9" ry="90" fill="#fff" opacity=".5" filter="url(#mv4Soft)"/>
  </g>

  <g class="gh-thumb">
    <path d="M662,534 C640,500 602,486 556,488 C502,491 444,501 402,511 C378,517 368,532 376,550 C384,568 406,575 432,573 C482,569 536,562 588,556 C628,551 658,540 662,534 Z" fill="url(#mv4Glove)" stroke="#1e293b" stroke-opacity=".68" stroke-width="7" stroke-linejoin="round"/>
    <ellipse cx="516" cy="508" rx="92" ry="9" fill="#fff" opacity=".48" filter="url(#mv4Soft)"/>
  </g>

  <path d="M368,782 L606,782 L606,872 L368,872 Z" fill="url(#mv4Cuff)"/>
  <path d="M368,796 L606,796 M368,830 L606,830" stroke="#fff" stroke-width="6" opacity=".55"/>
</svg>`;
  }

  function hudHand() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900">
  <defs>
    <linearGradient id="mv5Ink" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#232f44"/>
      <stop offset=".6" stop-color="#121926"/>
      <stop offset="1" stop-color="#080d17"/>
    </linearGradient>
    <linearGradient id="mv5Edge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#0ea5e9" stop-opacity=".25"/>
      <stop offset=".35" stop-color="#bae6fd" stop-opacity=".95"/>
      <stop offset=".65" stop-color="#0ea5e9" stop-opacity=".35"/>
      <stop offset="1" stop-color="#38bdf8" stop-opacity=".85"/>
    </linearGradient>
    <filter id="mv5Soft"><feGaussianBlur stdDeviation="8"/></filter>
    <filter id="mv5Wide"><feGaussianBlur stdDeviation="22"/></filter>
    <clipPath id="mv5Body"><path d="M326,548 C326,478 340,428 372,410 C416,386 490,382 550,400 C610,418 648,458 652,522 C655,590 643,670 635,740 C629,795 627,850 627,900 L349,900 C351,845 343,785 337,725 C331,655 324,610 326,548 Z"/></clipPath>
  </defs>

  <ellipse class="gh-contact" cx="566" cy="96" rx="44" ry="10" fill="#020617" opacity=".34" filter="url(#mv5Soft)"/>
  <ellipse cx="566" cy="88" rx="62" ry="17" fill="#38bdf8" opacity=".28" filter="url(#mv5Wide)"/>
  <circle cx="566" cy="100" r="56" fill="none" stroke="#38bdf8" stroke-width="4" opacity=".65"/>
  <circle cx="566" cy="100" r="42" fill="none" stroke="#bae6fd" stroke-width="2" stroke-dasharray="10 9" opacity=".8"/>
  <path d="M566,30 L566,48 M566,152 L566,170 M496,100 L514,100 M618,100 L636,100" stroke="#38bdf8" stroke-width="5" stroke-linecap="round"/>

  <path d="M326,548 C326,478 340,428 372,410 C416,386 490,382 550,400 C610,418 648,458 652,522 C655,590 643,670 635,740 C629,795 627,850 627,900 L349,900 C351,845 343,785 337,725 C331,655 324,610 326,548 Z" fill="url(#mv5Ink)" stroke="url(#mv5Edge)" stroke-width="5" stroke-linejoin="round"/>
  <g clip-path="url(#mv5Body)">
    <path d="M380,560 L450,525 L480,595 L410,630 Z M500,550 L575,520 L605,590 L530,625 Z" fill="#38bdf8" opacity=".1"/>
    <circle cx="430" cy="640" r="5" fill="#38bdf8"/>
    <circle cx="520" cy="610" r="5" fill="#38bdf8"/>
    <circle cx="470" cy="730" r="5" fill="#38bdf8"/>
  </g>

  <g fill="#131b2a" stroke="#0ea5e9" stroke-opacity=".75" stroke-width="3">
    <rect x="348" y="392" width="84" height="140" rx="20"/>
    <rect x="440" y="368" width="86" height="148" rx="20"/>
    <rect x="534" y="344" width="86" height="156" rx="20"/>
  </g>

  <g class="gh-finger">
    <path d="M534,520 C533,430 535,335 541,245 C544,195 548,150 554,128 C558,112 562,104 566,104 C570,104 574,112 578,128 C584,150 588,195 591,245 C597,335 599,430 598,520 Z" fill="#131b2a" stroke="url(#mv5Edge)" stroke-width="5" stroke-linejoin="round"/>
    <rect x="558" y="170" width="7" height="250" fill="#bae6fd" opacity=".55"/>
  </g>

  <g class="gh-thumb">
    <path d="M656,518 C636,488 602,476 562,478 C512,481 458,491 412,501 C388,506 378,521 385,537 C392,553 412,559 436,557 C484,553 536,546 588,540 C624,536 650,526 656,518 Z" fill="#131b2a" stroke="url(#mv5Edge)" stroke-width="5" stroke-linejoin="round"/>
    <rect x="430" y="500" width="130" height="7" fill="#bae6fd" opacity=".5"/>
  </g>

  <path d="M430,610 L446,624 L462,610 M430,634 L446,648 L462,634" fill="none" stroke="#38bdf8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>
</svg>`;
  }

  window.GlobeHandVariants = {
    1: { label: 'Holograma', tip: [566, 108], svg: holoHand },
    2: { label: 'Píxel', tip: [560, 96], svg: pixelHand },
    3: { label: 'Mecha', tip: [572, 112], svg: mechaHand },
    4: { label: 'Mascota', tip: [556, 118], svg: mascotHand },
    5: { label: 'Neón HUD', tip: [566, 104], svg: hudHand }
  };
})();
