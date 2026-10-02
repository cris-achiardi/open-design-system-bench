import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

// Implement the task here, as this standalone component (keep the class name
// and the `task-screen` selector; the app renders it). Use an inline
// `template` or a `templateUrl` beside this file, and add more components in
// src/task/ if the task needs them.
//
// This design system ships web components. They are already registered (see
// src/main.ts), so use them as tags in the template; there is nothing to import
// per component. CUSTOM_ELEMENTS_SCHEMA is what lets Angular accept them:
//
//   template: '<some-element some-attribute="value">Label</some-element>'
//
// The available element names and their attributes are declared in
// src/system-elements.d.ts.
@Component({
  selector: 'task-screen',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: '',
})
export class TaskComponent {}
