#!/usr/bin/env python3
"""Prepare/recover owned immutable review inputs; refuse unsafe worktree cleanup."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True  # Installed workflow instructions remain read-only.
HELPER = Path(__file__).resolve().parents[2] / 'elef-campaign/scripts/campaign_state.py'
SPEC = importlib.util.spec_from_file_location('campaign_processes', HELPER)
PROCESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROCESS)


def git(root, *args):
    r = subprocess.run(['git', '-C', str(root), *args], text=True, capture_output=True)
    if r.returncode:
        raise ValueError(r.stderr.strip())
    return r.stdout.strip()


def hash_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, obj):
    temp = path.with_suffix('.writing')
    temp.write_text(json.dumps(obj, indent=2)+'\n')
    os.replace(temp, path)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('command', choices=['prepare', 'cleanup'])
    ap.add_argument('phase', type=int, choices=range(13))
    ap.add_argument('round', type=int, choices=range(1, 11))
    a = ap.parse_args()
    root = Path(git(Path.cwd(), 'rev-parse', '--show-toplevel')).resolve()
    bundle = root / f'tmp/reviews/phase-{a.phase}-round-{a.round}'
    worktree = bundle / 'worktree'
    owner_file = bundle / 'owner.json'
    identity = {'root': str(root), 'phase': a.phase, 'round': a.round, 'worktree': str(worktree)}
    owner = json.loads(owner_file.read_text()) if owner_file.exists() else None
    if owner and any(owner.get(k) != v for k,v in identity.items()):
        raise ValueError('review bundle ownership differs; preserve it and use a new round')
    if a.command == 'cleanup':
        if not bundle.exists():
            print('no bundle to clean'); return
        if not owner:
            raise ValueError('refusing cleanup of a bundle without ownership metadata')
        receipt = root / f'docs/refactor/execution/phase-{a.phase}-round-{a.round}-context.json'
        context = json.loads(receipt.read_text()) if receipt.exists() else None
        if context:
            if context.get('state') not in ('completed','failed','interrupted') or not context.get('terminal_evidence'):
                raise ValueError('reviewer session has no confirmed terminal evidence; preserve its worktree')
            if PROCESS.process_alive(context.get('pid'),context.get('process_start')):
                raise ValueError('reviewer process still active; preserve its worktree')
            if context['state'] == 'completed':
                report = root / f'docs/refactor/reviews/phase-{a.phase}-round-{a.round}.md'
                if not report.exists() or hash_file(report) != context.get('report_sha256'):
                    raise ValueError('complete review is not safely collected; preserve its worktree')
        elif (bundle/'report.md').exists():
            raise ValueError('unregistered review report; recover its session before cleanup')
        if worktree.exists():
            active = PROCESS.checkout_processes(str(worktree))
            if active:
                raise ValueError(f'reviewer worktree still in use by processes {active}; preserve it')
            if git(worktree, 'rev-parse', '--show-toplevel') != str(worktree):
                raise ValueError('worktree path is not its own Git toplevel')
            if git(worktree, 'rev-parse', 'HEAD') != owner['head']:
                raise ValueError('review worktree HEAD changed; preserve it for inspection')
            dirty = git(worktree, 'status', '--porcelain', '--untracked-files=all')
            if dirty:
                raise ValueError('review worktree is dirty; preserved without removal:\n'+dirty)
            git(root, 'worktree', 'remove', str(worktree))
        print(f'clean reviewer worktree removed; bundle retained at {bundle}'); return
    status_path = root / 'docs/refactor/status.json'
    status = json.loads(status_path.read_text())
    if status['current_phase'] != a.phase or status['review_round'] != a.round or status['phase_state'] != 'CHECK':
        raise ValueError('requested phase/round differs from CHECK state')
    head, base = status['head_sha'], status['phase_base_sha']
    if not all(isinstance(sha, str) and len(sha) in (40,64) for sha in (head,base)):
        raise ValueError('full base/head SHAs required')
    git(root, 'merge-base', '--is-ancestor', base, head)
    git(root, 'merge-base', '--is-ancestor', head, 'HEAD')
    contracts = list((root/'docs/refactor/phases').glob(f'{a.phase:02d}-*.md'))
    if len(contracts) != 1:
        raise ValueError('one phase contract required')
    plan = root / f'docs/refactor/execution/phase-{a.phase}-plan.md'
    if hash_file(plan) != status['frozen_plan_sha256'] or hash_file(contracts[0]) != status['phase_contract_sha256']:
        raise ValueError('frozen plan or phase contract hash mismatch')
    checked = subprocess.run([sys.executable, str(HELPER), '--root', str(root), 'validate', '--json'], capture_output=True, text=True)
    if checked.returncode:
        raise ValueError('state validation failed: '+checked.stdout+checked.stderr)
    snapshot = status_path.read_bytes()
    if owner:
        saved_path = bundle/'status.json'
        if not saved_path.exists():
            raise ValueError('owned bundle lacks original status snapshot; preserve it for recovery')
        snapshot = saved_path.read_bytes()
        saved_status = json.loads(snapshot)
        immutable_keys = ('current_phase','review_round','head_sha','phase_base_sha','frozen_plan_sha256','phase_contract_sha256')
        if any(saved_status.get(key) != status.get(key) for key in immutable_keys):
            raise ValueError('immutable review identity changed; use a new round')
    inputs = {'CONSTITUTION.md': (root/'docs/refactor/CONSTITUTION.md').read_bytes(),
              'PHASE.md': contracts[0].read_bytes(), 'PLAN.md': plan.read_bytes(),
              'status.json': snapshot,
              'diff.patch': subprocess.check_output(['git','-C',str(root),'diff',base,head]),
              'diffstat.txt': subprocess.check_output(['git','-C',str(root),'diff','--stat',base,head]),
              'SHAS.txt': f'phase={a.phase}\nround={a.round}\nphase_base_sha={base}\nhead_sha={head}\n'.encode()}
    for source in sorted((root/'docs/refactor/execution').glob(f'phase-{a.phase}-*')):
        # Plans have a dedicated input. Round launch receipts can evolve while review runs.
        if source.is_file() and source != plan and '-context.json' not in source.name:
            inputs['evidence/'+source.name] = source.read_bytes()
    for source in sorted((root/f'docs/refactor/execution/phase-{a.phase}-gate-attempts').rglob('*')):
        if source.is_file():
            inputs['evidence/'+str(source.relative_to(root/'docs/refactor/execution'))] = source.read_bytes()
    for source in sorted((root/'docs/refactor/reviews').glob(f'phase-{a.phase}-round-*.md')):
        round_num = int(source.stem.rsplit('-',1)[1])
        if round_num < a.round:
            inputs['evidence/'+source.name] = source.read_bytes()
    template = (Path(__file__).resolve().parent.parent/'references/reviewer-prompt.md').read_text()
    for key,value in {'PHASE':str(a.phase), 'ROUND':str(a.round), 'BASE':base, 'HEAD':head, 'BUNDLE':str(bundle), 'WORKTREE':str(worktree)}.items():
        template = template.replace('{{'+key+'}}', value)
    inputs['REVIEWER-PROMPT.md'] = template.encode()
    hashes = {k:hashlib.sha256(v).hexdigest() for k,v in inputs.items()}
    proposed = {**identity, 'head':head, 'base':base, 'inputs':hashes}
    if bundle.exists() and not owner:
        raise ValueError('existing unowned bundle; preserve it and use a new round')
    if owner and owner != proposed:
        raise ValueError('review inputs changed; preserve this round and prepare a new round')
    if owner:
        for name,expected in hashes.items():
            file = bundle/name
            if file.exists() and hash_file(file) != expected:
                raise ValueError(f'bundle input changed: {name}; preserve this round')
        if (bundle/'report.md').exists():
            print(f'existing report; collect it instead of relaunching: {bundle}/report.md'); return
        receipt = root / f'docs/refactor/execution/phase-{a.phase}-round-{a.round}-context.json'
        if receipt.exists() and json.loads(receipt.read_text()).get('state') in ('launching','running'):
            print(f'existing reviewer session; recover/monitor it instead of relaunching: {receipt}'); return
    else:
        bundle.mkdir(parents=True)
        save(owner_file, proposed)
    for name,data in inputs.items():
        target = bundle/name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_bytes(data)
    if worktree.exists():
        if git(worktree, 'rev-parse', '--show-toplevel') != str(worktree) or git(worktree, 'rev-parse', 'HEAD') != head:
            raise ValueError('existing reviewer worktree differs from the candidate')
        if git(worktree, 'status', '--porcelain', '--untracked-files=all'):
            raise ValueError('existing review worktree dirty; preserved')
    else:
        git(root, 'worktree', 'add', '--detach', str(worktree), head)
    print(f'prompt: {bundle}/REVIEWER-PROMPT.md\nworktree: {worktree}\nreport: {bundle}/report.md')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
