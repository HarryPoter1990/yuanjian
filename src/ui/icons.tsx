import type { SVGProps } from 'react';
import paths from './icon-paths.json';
import '../styles/icons.css';

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function icon(name: keyof typeof paths) {
  return function FluentIcon({ size = 20, className = '', ...props }: IconProps) {
    const source = paths[name];
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
        className={`fluent-icon ${className}`}
        data-fluent-icon={name}
        {...props}
      >
        {(['regular', 'filled'] as const).map((variant) => (
          <g className={`fluent-icon-${variant}`} key={variant}>
            {(source[variant] || source.regular).map((path, index) => (
              <path
                key={index}
                d={path.d}
                fillRule={'fillRule' in path && path.fillRule === 'evenodd' ? 'evenodd' : undefined}
                clipRule={'clipRule' in path && path.clipRule === 'evenodd' ? 'evenodd' : undefined}
              />
            ))}
          </g>
        ))}
      </svg>
    );
  };
}

export const AlignLeft = icon('AlignLeft');
export const ArrowDownToLine = icon('ArrowDownToLine');
export const ArrowLeftRight = icon('ArrowLeftRight');
export const Bold = icon('Bold');
export const CalendarDays = icon('CalendarDays');
export const Check = icon('Check');
export const ChevronDown = icon('ChevronDown');
export const ChevronLeft = icon('ChevronLeft');
export const ChevronRight = icon('ChevronRight');
export const Code2 = icon('Code2');
export const Columns2 = icon('Columns2');
export const Download = icon('Download');
export const Ellipsis = icon('Ellipsis');
export const FilePlus2 = icon('FilePlus2');
export const FileText = icon('FileText');
export const Folder = icon('Folder');
export const FolderOpen = icon('FolderOpen');
export const FolderPlus = icon('FolderPlus');
export const Hash = icon('Hash');
export const ImagePlus = icon('ImagePlus');
export const Italic = icon('Italic');
export const Link2 = icon('Link2');
export const List = icon('List');
export const ListChecks = icon('ListChecks');
export const LoaderCircle = icon('LoaderCircle');
export const Maximize = icon('Maximize');
export const Menu = icon('Menu');
export const Network = icon('Network');
export const Palette = icon('Palette');
export const PanelLeftClose = icon('PanelLeftClose');
export const PanelLeftOpen = icon('PanelLeftOpen');
export const PanelRightClose = icon('PanelRightClose');
export const PanelRightOpen = icon('PanelRightOpen');
export const Pin = icon('Pin');
export const Plus = icon('Plus');
export const Quote = icon('Quote');
export const Redo2 = icon('Redo2');
export const RefreshCw = icon('RefreshCw');
export const RotateCcw = icon('RotateCcw');
export const Save = icon('Save');
export const Search = icon('Search');
export const Settings = icon('Settings');
export const Settings2 = icon('Settings2');
export const Sigma = icon('Sigma');
export const Table2 = icon('Table2');
export const Type = icon('Type');
export const Undo2 = icon('Undo2');
export const X = icon('X');
export const ZoomIn = icon('ZoomIn');
export const ZoomOut = icon('ZoomOut');
export const Copy = icon('Copy');
export const Heading1 = icon('Heading1');
