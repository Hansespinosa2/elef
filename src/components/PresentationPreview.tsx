import type { Presentation, ThemeMode } from '../domain/presentation';
import { PresentationEditor } from './PresentationEditor';

interface Props {
  presentation: Presentation;
  theme: ThemeMode;
  source: string;
  onSourceChange: (source: string) => void;
}

export function PresentationPreview(props: Props) {
  return <PresentationEditor {...props} />;
}
