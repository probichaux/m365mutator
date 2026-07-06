import { describe, it, expect } from 'vitest';
import { siteUrlToGraphPath } from './sites.js';

describe('siteUrlToGraphPath', () => {
  it('converts a full https URL to a hostname:path Graph path', () => {
    expect(siteUrlToGraphPath('https://contoso.sharepoint.com/sites/marketing'))
      .toBe('/sites/contoso.sharepoint.com:/sites/marketing');
  });

  it('prepends https:// when the prefix is omitted', () => {
    expect(siteUrlToGraphPath('contoso.sharepoint.com/sites/marketing'))
      .toBe('/sites/contoso.sharepoint.com:/sites/marketing');
  });

  it('addresses the root site by hostname only', () => {
    expect(siteUrlToGraphPath('contoso.sharepoint.com')).toBe('/sites/contoso.sharepoint.com');
    expect(siteUrlToGraphPath('https://contoso.sharepoint.com/')).toBe('/sites/contoso.sharepoint.com');
  });

  it('strips trailing slashes from the site path', () => {
    expect(siteUrlToGraphPath('contoso.sharepoint.com/sites/hr/'))
      .toBe('/sites/contoso.sharepoint.com:/sites/hr');
  });

  it('throws on values that are not URLs', () => {
    expect(() => siteUrlToGraphPath('not a url')).toThrow();
  });
});
