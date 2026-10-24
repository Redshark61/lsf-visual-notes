import { Pipe, PipeTransform } from '@angular/core';
import { SignGlyph } from '../core/models/sign.model';
import { ColoredPath, glyphPaths } from '../core/utils/glyph-paths';

/** `@for (p of glyph | glyphPaths; track $index) { <path [attr.d]="p.d" [attr.fill]="p.color" /> }` */
@Pipe({ name: 'glyphPaths' })
export class GlyphPathsPipe implements PipeTransform {
  transform(glyph: SignGlyph): ColoredPath[] {
    return glyphPaths(glyph);
  }
}
