import type { Presentation, ThemeMode } from '../domain/presentation';
import { ObsidianStyleEditor } from './ObsidianStyleEditor';

interface Props {
  presentation: Presentation;
  theme: ThemeMode;
  source: string;
  onSourceChange: (source: string) => void;
}

export function PresentationPreview(props: Props) {
  return <ObsidianStyleEditor {...props} />;
}
