import { Component, type ReactNode } from 'react';

/** Never a blank white page: if rendering throws, one line and a reload button. The data stays on the phone. */
export class Crash extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="crash" role="alert">
        <p>משהו השתבש. הנתונים שמורים בטלפון.</p>
        <button type="button" className="btn btn-primary" onClick={() => location.replace(location.pathname)}>
          טעינה מחדש
        </button>
      </div>
    );
  }
}
