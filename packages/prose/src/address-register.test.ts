import { describe, expect, it } from 'vitest';
import { checkAddressRegister } from './address-register.js';
import { toNfcText } from './nfc.js';

const ledger = [
  { from: '하준', to: '서연', terms: ['선배님'], level: 'polite' as const },
  { from: '서연', to: '하준', terms: ['하준아'], level: 'plain' as const },
];

describe('address terms against the ledger (ADR-0063)', () => {
  it('flags a line that uses a polite pair’s term in 반말, and the reverse', () => {
    const f = checkAddressRegister(
      toNfcText('“선배님, 여기 있었어?”\n\n“하준아, 이리 오세요.”\n\n“선배님, 여기 계셨어요?”'),
      ledger,
    );
    expect(f.map((x) => x.quote)).toEqual(['“선배님, 여기 있었어?”', '“하준아, 이리 오세요.”']);
    expect(f[0]?.message).toContain('장부의 말높이는 존댓말');
  });

  it('ignores lines without a registered term and terms inside another word', () => {
    expect(checkAddressRegister(toNfcText('“여기 있었어?”\n\n“왕선배님은 갔어.”'), ledger)).toEqual(
      [],
    );
  });
});
