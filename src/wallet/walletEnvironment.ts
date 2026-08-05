export function isIosSafari(targetWindow: Window = window): boolean {
  const { userAgent, platform, maxTouchPoints } = targetWindow.navigator;
  const isIosDevice = /iP(hone|ad|od)/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  const isWebKit = /WebKit/i.test(userAgent);
  const excludedBrowsers = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser|UCBrowser/i.test(userAgent);

  return isIosDevice && isWebKit && !excludedBrowsers;
}

export function isStandaloneDisplayMode(targetWindow: Window = window): boolean {
  const mediaMatches =
    typeof targetWindow.matchMedia === "function" && targetWindow.matchMedia("(display-mode: standalone)").matches;
  const navigatorStandalone = Boolean((targetWindow.navigator as Navigator & { standalone?: boolean }).standalone);

  return mediaMatches || navigatorStandalone;
}

export function isIosStandaloneWebApp(targetWindow: Window = window): boolean {
  return isIosSafari(targetWindow) && isStandaloneDisplayMode(targetWindow);
}
