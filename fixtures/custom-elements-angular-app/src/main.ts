import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
// Registers the design system's custom elements with the browser. This import
// is the reason no per-component import is needed anywhere else: once the
// elements are defined, they are written as ordinary tags in templates.
import '__COMPONENTS_PKG__';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection()],
}).catch((err) => console.error(err));
