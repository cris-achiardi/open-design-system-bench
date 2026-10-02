// The design system's entry point, declared as an opaque ambient module.
//
// src/main.ts imports it once for its side effect: registering the custom
// elements with the browser. That is a RUNTIME concern, resolved by the path
// alias in tsconfig.serve.json. Type-checking must not follow it into the
// system's own source tree, which would compile the library under this
// program's options and fail the compile dimension on errors that are not the
// task's. A web-component system's API surface is its ELEMENTS, and those are
// declared in src/system-elements.d.ts.
declare module '__COMPONENTS_PKG__';
declare module '__COMPONENTS_PKG__/*';
