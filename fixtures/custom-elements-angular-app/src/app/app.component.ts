import { Component } from '@angular/core';
import { TaskComponent } from '../task/task.component';

@Component({
  selector: 'app-root',
  imports: [TaskComponent],
  template: '<task-screen />',
})
export class AppComponent {}
