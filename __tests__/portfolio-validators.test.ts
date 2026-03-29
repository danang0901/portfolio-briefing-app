import { validateTicker, validateUnits } from '../lib/portfolio-validators';

describe('validateTicker', () => {
  it('returns uppercased ticker for valid input', () => {
    expect(validateTicker('aapl')).toBe('AAPL');
    expect(validateTicker('BHP')).toBe('BHP');
    expect(validateTicker('  tls  ')).toBe('TLS');
  });

  it('returns null for empty string', () => {
    expect(validateTicker('')).toBeNull();
    expect(validateTicker('   ')).toBeNull();
  });

  it('returns null for ticker longer than 10 characters', () => {
    expect(validateTicker('TOOLONGTICR')).toBeNull(); // 11 chars
    expect(validateTicker('VERYLONGTICKER')).toBeNull();
  });

  it('accepts exactly 10 characters', () => {
    expect(validateTicker('TENCHARACT')).toBe('TENCHARACT'); // 10 chars
  });
});

describe('validateUnits', () => {
  it('returns integer for valid positive input', () => {
    expect(validateUnits('100')).toBe(100);
    expect(validateUnits('1')).toBe(1);
    expect(validateUnits('9999')).toBe(9999);
  });

  it('truncates decimals via parseInt', () => {
    expect(validateUnits('10.9')).toBe(10);
    expect(validateUnits('1.1')).toBe(1);
  });

  it('returns null for zero', () => {
    expect(validateUnits('0')).toBeNull();
  });

  it('returns null for negative numbers', () => {
    expect(validateUnits('-1')).toBeNull();
    expect(validateUnits('-100')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(validateUnits('')).toBeNull();
    expect(validateUnits('abc')).toBeNull();
    expect(validateUnits('NaN')).toBeNull();
  });
});
