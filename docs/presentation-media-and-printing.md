# Presentation media and printing

## Slides

The slide overview appears beside the live preview in the presentation editor. Select a thumbnail, then use Add, Duplicate, Delete, or the arrow buttons to edit slide order. These actions update Markdown in one editor operation, so Undo restores the preceding source. Separators inside fenced code and initial front matter are left alone.

Overflow warnings appear below the overview when rendered content extends beyond a slide frame. They identify the slide and suggest shortening, reflowing, or splitting its content; they do not alter the source or shrink its text.

## Images and video

Use **Add image or MP4**, paste an image or MP4 file, or drop a file onto the preview. Choose **Contain** to keep the whole image visible or **Cover** to fill the slide and crop the edges. The generated Markdown uses a content digest, for example:

```markdown
![Architecture diagram](elef-asset:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef "fit:contain")
```

Elef keeps the image or MP4 in the presentation's attachments. Work-package exports include those files and their digests, so import preserves the Markdown reference. MP4 slides render with playback controls in preview and Present mode.

## Save as PDF

Choose **Print draft / save PDF** in the editor for the latest saved draft. When a published release exists, **Print published release** opens that pinned version. In the print view, choose **Print / Save PDF** and select the browser's PDF destination. The print layout uses one 16:9 landscape page per slide and carries the presentation theme and images into the print output. MP4 playback is available in preview and Present; the PDF does not contain video playback.
