export function isIosSafari(targetWindow: Window = window): boolean {
  const { userAgent, platform, maxTouchPoints } = targetWindow.navigator;
  const isIosDevice = /iP(hone|ad|od)/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  const isWebKit = /WebKit/i.test(userAgent);
  const excludedBrowsers = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser|UCBrowser/i.test(userAgent);

  return isIosDevice && isWebKit && !excludedBrowsers;
}
