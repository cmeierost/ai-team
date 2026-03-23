// Re-export the public registry API
export { registerRenderer, getRenderer } from './registry';

// Load all built-in renderers — side effects register each one via registerRenderer
import './FsTreeRenderer';
import './FsListRenderer';
import './FsReadRenderer';
import './ComAskRenderer';
import './FsWhoShouldRenderer';
import './FsSearchRenderer';
