import { describe, expect, it } from 'vitest';
import { toNfcText } from './nfc.js';
import { checkStatusWindows, parseStatusWindows, statusWindowFormat } from './status-window.js';

const windows = (s: string) => parseStatusWindows(toNfcText(s));

describe('status windows (ADR-0063)', () => {
  it('parses a bracketed window with its labels in order, never quoted speech', () => {
    const w = windows(
      '그가 중얼거렸다.\n\n【상태창】\n【이름: 강하준】\n【레벨: 1】\n【힘: 10】\n\n“이름: 강하준이다.”',
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({
      bracket: '【',
      labels: ['이름', '레벨', '힘'],
      crowded_lines: [],
    });
  });

  it('parses an unbracketed label: value block and reports crowded lines', () => {
    const w = windows('[상태창]\n이름: 강하준\n힘: 10 / 민첩: 12');
    expect(w[0]?.labels).toEqual(['이름', '힘', '민첩']);
    expect(w[0]?.crowded_lines).toEqual(['힘: 10 / 민첩: 12']);
    expect(checkStatusWindows(w, undefined)).toEqual([
      expect.objectContaining({ rule: 'FMT-WINDOW-02' }),
    ]);
  });

  it('fixes the format from the first accepted window and flags drift', () => {
    const format = statusWindowFormat([
      {
        chapter_no: 2,
        windows: windows('【이름: 강하준】\n【레벨: 1】\n【힘: 10】\n【민첩: 12】'),
      },
    ]);
    expect(format).toEqual({
      bracket: '【',
      labels: ['이름', '레벨', '힘', '민첩'],
      chapter_no: 2,
    });
    expect(
      checkStatusWindows(windows('【이름: 강하준】\n【레벨: 2】\n【힘: 11】'), format),
    ).toEqual([]);
    const drift = checkStatusWindows(windows('[성명: 강하준]\n[등급: F]\n[근력: 11]'), format);
    expect(drift).toEqual([expect.objectContaining({ rule: 'FMT-WINDOW-01' })]);
    expect(drift[0]?.message).toContain('괄호');
  });
});
