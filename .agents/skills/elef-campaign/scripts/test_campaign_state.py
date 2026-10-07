#!/usr/bin/env python3
"""Disposable Git fixtures for restart, evidence identity and review-worktree safety.
Run: PYTHONDONTWRITEBYTECODE=1 python3 .agents/skills/elef-campaign/scripts/test_campaign_state.py
All verdicts here are synthetic parser fixtures, never real phase evidence.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('campaign', HERE/'campaign_state.py')
campaign = importlib.util.module_from_spec(spec)
spec.loader.exec_module(campaign)
SOURCE = Path(os.environ.get('ELEF_SOURCE_ROOT', Path.cwd()))
ENV = {'os':'linux','arch':'fixture','ram_mb':8192,'swap_mb':0,'cpu_count':2,'free_disk_mb':50000,'display_mode':'none','tauri_native_runner':'unavailable'}


class Recovery(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='elef-state-fixture-')
        self.root = Path(self.temp.name)
        self.git('init','-b','feat/refactor-desktop-and-web')
        self.git('config','user.email','fixture@example.invalid')
        self.git('config','user.name','Fixture')
        self.git('config','commit.gpgsign','false')
        shutil.copytree(SOURCE/'docs/refactor/phases',self.root/'docs/refactor/phases')
        shutil.copyfile(SOURCE/'docs/refactor/CONSTITUTION.md',self.root/'docs/refactor/CONSTITUTION.md')
        self.write('packages/client/source.ts','export const value=1;\n')
        self.write('.gitignore','tmp/\n')
        self.commit('Create fixture base')
        self.base=self.git('rev-parse','HEAD')
        self.st=json.loads((SOURCE/'docs/refactor/status.template.json').read_text())
        self.st.update(campaign_base_sha=self.base,phase_base_sha=self.base,head_sha=self.base,phase_contract_sha256=campaign.sha256(str(self.root/'docs/refactor/phases/00-baseline.md')),execution_environment=ENV.copy())
        self.save()
        self.commit('Initialize fixture PLAN')
        self.original_probe=campaign.probe
        campaign.probe=lambda root: {'execution_environment':ENV.copy(),'extra':{}}

    def tearDown(self):
        campaign.probe=self.original_probe
        self.temp.cleanup()

    def git(self,*args):
        r=subprocess.run(['git','-C',str(self.root),*args],capture_output=True,text=True)
        if r.returncode: raise AssertionError(r.stderr)
        return r.stdout.strip()

    def write(self,path,text):
        p=self.root/path; p.parent.mkdir(parents=True,exist_ok=True); p.write_text(text)

    def save(self):
        campaign.write_status(str(self.root),self.st)

    def commit(self,message):
        self.git('add','--all'); self.git('commit','-m',message)

    def freeze(self):
        self.write('docs/refactor/execution/phase-0-plan.md','fixture frozen plan\n')
        self.st.update(phase_state='DO',frozen_plan_sha256=campaign.sha256(str(self.root/'docs/refactor/execution/phase-0-plan.md')))
        self.save(); self.commit('Freeze fixture plan')
        self.write('packages/client/source.ts','export const value=2;\n')
        self.commit('Implement fixture change')
        self.candidate=self.git('rev-parse','HEAD')

    def check(self):
        self.freeze()
        stdout=json.dumps({'phase':0,'result':'PASS','head':self.candidate})+'\nELEF_PHASE_0=PASS\n'
        self.attempt='a'*32
        self.prefix=f'docs/refactor/execution/phase-0-gate-attempts/{self.attempt}'
        self.write(self.prefix+'/stdout.txt',stdout)
        self.write(self.prefix+'/stderr.log','')
        self.meta={'command':'bin/check phase 0 --json','exit':0,'head':self.candidate,'stdout_sha256':campaign.digest(stdout),'stderr_sha256':campaign.digest(''),'duration_s':1,'tier':'phase','attempt_id':self.attempt,'state':'completed'}
        self.write('docs/refactor/execution/phase-0-gate.json',json.dumps(self.meta))
        self.write(self.prefix+'/result.json',json.dumps(self.meta))
        snapshot={**self.st,'head_sha':self.candidate}
        snapshot_text=json.dumps(snapshot,indent=2)+'\n'
        self.write(self.prefix+'/status.json',snapshot_text)
        self.meta['status_sha256']=campaign.digest(snapshot_text)
        self.write('docs/refactor/execution/phase-0-gate.json',json.dumps(self.meta))
        self.write(self.prefix+'/result.json',json.dumps(self.meta))
        self.st.update(phase_state='CHECK',head_sha=self.candidate,review_round=1)
        self.save(); self.commit('Request fixture review')

    def report(self):
        contract=(self.root/'docs/refactor/phases/00-baseline.md').read_text()
        ids=re.findall(r'\*\*(P\d{2}-\d{2})\*\*',contract)
        text=f'Candidate: {self.candidate}\nBase: {self.base}\nReview context: synthetic-fixture\n'
        text+='\n'.join(f'| {i} | PASS | synthetic parser fixture | | |' for i in ids)+ '\n'
        text+='\n'.join(f'| I{i:02d} | N.A. | synthetic parser fixture | | |' for i in range(1,19))+'\nResult: PASS\n'
        self.write('docs/refactor/reviews/phase-0-round-1.md',text)
        receipt={'phase':0,'round':1,'head':self.candidate,'base':self.base,'mechanism':'synthetic fixture','identity':'synthetic-fixture','conversation_inherited':False,'launch':'synthetic fixture, no agent launched','report_sha256':campaign.digest(text),'state':'completed','terminal_evidence':'synthetic fixture completion'}
        self.write('docs/refactor/execution/phase-0-round-1-context.json',json.dumps(receipt))

    def act(self):
        self.st['phase_state']='ACT'; self.save(); self.commit('Record fixture ACT')

    def finish(self):
        self.check(); self.report(); self.act()
        self.st.update(phase_state='PASS',last_completed_phase=0)
        self.save(); self.commit('Record fixture PASS')
        return self.git('rev-parse','HEAD')

    def test_initial_plan_rejects_staged_and_unstaged_source(self):
        self.write('packages/client/source.ts','unstaged source\n')
        self.assertFalse(campaign.validate(str(self.root))['ok'])
        self.git('add','packages/client/source.ts')
        self.assertFalse(campaign.validate(str(self.root))['ok'])

    def test_initial_plan_rejects_new_untracked_source(self):
        self.write('packages/client/new.ts','new source\n')
        self.assertFalse(campaign.validate(str(self.root))['ok'])

    def test_replanning_preserves_legal_do_but_forbids_new_source(self):
        self.freeze()
        self.st.update(phase_state='PLAN',frozen_plan_sha256=None)
        self.save()
        self.assertTrue(campaign.validate(str(self.root))['ok'])
        self.commit('Enter fixture re-plan')
        self.write('packages/client/source.ts','new unplanned source\n')
        self.assertFalse(campaign.validate(str(self.root))['ok'])

    def test_gate_and_review_without_act_do_not_complete_phase(self):
        self.check(); self.report()
        self.assertEqual(campaign.reconstruct(str(self.root))['earliest_unproven_phase'],0)
        self.st.update(phase_state='PASS',last_completed_phase=0)
        self.save()
        self.assertFalse(campaign.validate(str(self.root))['ok'])
        self.assertEqual(campaign.reconstruct(str(self.root))['earliest_unproven_phase'],0)
        self.commit('Invalid fixture PASS without ACT')
        self.assertEqual(campaign.reconstruct(str(self.root))['earliest_unproven_phase'],0)

    def test_stale_review_candidate_is_rejected(self):
        self.check(); self.report()
        p=self.root/'docs/refactor/reviews/phase-0-round-1.md'
        p.write_text(p.read_text().replace('Candidate: '+self.candidate,'Candidate: '+self.base))
        self.assertTrue(campaign.linked_evidence(str(self.root),0,self.st))

    def test_blocked_check_and_act_recover_same_review(self):
        self.check(); self.report()
        blocker={'code':'fixture','detail':'fixture','evidence':'fixture','unblock':'fixture','resume_state':'CHECK'}
        self.st.update(phase_state='BLOCKED',blocker=blocker)
        self.save(); self.commit('Block fixture CHECK')
        self.st.update(phase_state='CHECK',blocker=None)
        self.save(); self.commit('Resume fixture CHECK')
        self.act()
        blocker['resume_state']='ACT'
        self.st.update(phase_state='BLOCKED',blocker=blocker)
        self.save(); self.commit('Block fixture ACT')
        self.st.update(phase_state='ACT',blocker=None)
        self.save(); self.commit('Resume fixture ACT')
        self.st.update(phase_state='PASS',last_completed_phase=0)
        self.save(); self.commit('Complete recovered fixture')
        self.assertTrue(campaign.phase_proven(str(self.root),0)[0])

    def test_final_postcondition_is_a_machine_addressable_criterion(self):
        contract=(self.root/'docs/refactor/phases/12-cleanup.md').read_text()
        self.assertIn('P12-11',re.findall(r'\*\*(P\d{2}-\d{2})\*\*',contract))

    def test_all_thirteen_checkpoints_reconstruct_final_postcondition(self):
        for n in range(13):
            plan=f'docs/refactor/execution/phase-{n}-plan.md'
            self.write(plan,f'synthetic phase {n} frozen plan\n')
            self.st.update(phase_state='DO',frozen_plan_sha256=campaign.sha256(str(self.root/plan)))
            self.save(); self.commit(f'Freeze synthetic phase {n}')
            self.write('packages/client/source.ts',f'export const value={200+n};\n')
            self.commit(f'Implement synthetic phase {n}')
            head=self.git('rev-parse','HEAD'); base=self.st['phase_base_sha']
            stdout=json.dumps({'phase':n,'result':'PASS','head':head})+f'\nELEF_PHASE_{n}=PASS\n'
            attempt=f'{n+1:032x}'
            prefix=f'docs/refactor/execution/phase-{n}-gate-attempts/{attempt}'
            meta={'command':f'bin/check phase {n} --json','exit':0,'head':head,'stdout_sha256':campaign.digest(stdout),'duration_s':1,'tier':'phase','attempt_id':attempt,'state':'completed'}
            self.write(prefix+'/stdout.txt',stdout)
            self.write(prefix+'/stderr.log','')
            meta['stderr_sha256']=campaign.digest('')
            snapshot_text=json.dumps({**self.st,'head_sha':head},indent=2)+'\n'
            self.write(prefix+'/status.json',snapshot_text)
            meta['status_sha256']=campaign.digest(snapshot_text)
            self.write(prefix+'/result.json',json.dumps(meta))
            self.write(f'docs/refactor/execution/phase-{n}-gate.json',json.dumps(meta))
            self.st.update(phase_state='CHECK',head_sha=head,review_round=1)
            self.save(); self.commit(f'Request synthetic phase {n} review')
            contract=Path(campaign.phase_file(str(self.root),n)).read_text()
            ids=re.findall(r'\*\*(P\d{2}-\d{2})\*\*',contract)
            report=f'Candidate: {head}\nBase: {base}\nReview context: synthetic-fixture\n'
            for criterion in ids:
                verdict='PENDING(ACT)' if criterion=='P12-11' else 'PASS'
                report+=f'| {criterion} | {verdict} | synthetic parser fixture | | |\n'
            report+=''.join(f'| I{i:02d} | PASS | synthetic parser fixture | | |\n' for i in range(1,19))+'Result: PASS\n'
            self.write(f'docs/refactor/reviews/phase-{n}-round-1.md',report)
            receipt={'phase':n,'round':1,'head':head,'base':base,'mechanism':'synthetic fixture','identity':'synthetic-fixture','conversation_inherited':False,'launch':'synthetic fixture, no agent launched','report_sha256':campaign.digest(report),'state':'completed','terminal_evidence':'synthetic fixture completion'}
            self.write(f'docs/refactor/execution/phase-{n}-round-1-context.json',json.dumps(receipt))
            self.st['phase_state']='ACT'; self.save(); self.commit(f'Authorize synthetic phase {n}')
            self.st.update(phase_state='PASS',last_completed_phase=n); self.save()
            checked=campaign.validate(str(self.root))
            self.assertTrue(checked['ok'],checked['errors'])
            self.commit(f'Complete synthetic phase {n}')
            if n<12:
                checkpoint=self.git('rev-parse','HEAD')
                self.st.update(current_phase=n+1,phase_state='PLAN',phase_base_sha=checkpoint,head_sha=checkpoint,review_round=0,frozen_plan_sha256=None,phase_contract_sha256=campaign.sha256(campaign.phase_file(str(self.root),n+1)))
                self.save(); self.commit(f'Enter synthetic phase {n+1}')
        result=campaign.reconstruct(str(self.root))
        self.assertEqual(result['proven_contiguous_phases'],list(range(13)))
        self.assertIsNone(result['earliest_unproven_phase'])

    def test_selected_partial_attempt_cannot_pass(self):
        self.check()
        (self.root/(self.prefix+'/result.json')).unlink()
        self.assertFalse(campaign.gate_evidence(str(self.root),0)[0])

    def test_identical_replan_bytes_cannot_reuse_previous_freeze(self):
        self.freeze()
        frozen=self.st['frozen_plan_sha256']
        self.st.update(phase_state='PLAN',frozen_plan_sha256=None)
        self.save(); self.commit('Enter identical fixture re-plan')
        self.st.update(phase_state='DO',frozen_plan_sha256=frozen); self.save()
        self.assertFalse(campaign.validate(str(self.root))['ok'])
        self.assertTrue(campaign.validate(str(self.root),prospective=True)['ok'])
        self.write('packages/client/source.ts','illegal before new freeze\n')
        self.assertFalse(campaign.validate(str(self.root),prospective=True)['ok'])

    def test_blocked_act_still_requires_complete_review(self):
        self.check()
        blocker={'code':'fixture','detail':'fixture','evidence':'fixture','unblock':'fixture','resume_state':'ACT'}
        self.st.update(phase_state='BLOCKED',blocker=blocker); self.save()
        self.assertFalse(campaign.validate(str(self.root))['ok'])

    def test_nonzero_exit_cannot_pass_even_with_marker(self):
        self.check(); self.report()
        self.meta['exit']=1
        self.write('docs/refactor/execution/phase-0-gate.json',json.dumps(self.meta))
        self.write(self.prefix+'/result.json',json.dumps(self.meta))
        self.assertFalse(campaign.gate_evidence(str(self.root),0)[0])

    def test_boolean_phase_is_not_an_integer_verdict(self):
        self.check()
        stdout=json.dumps({'phase':False,'result':'PASS','head':self.candidate})+'\nELEF_PHASE_0=PASS\n'
        self.write(self.prefix+'/stdout.txt',stdout)
        self.meta['stdout_sha256']=campaign.digest(stdout)
        self.write('docs/refactor/execution/phase-0-gate.json',json.dumps(self.meta))
        self.write(self.prefix+'/result.json',json.dumps(self.meta))
        self.assertFalse(campaign.gate_evidence(str(self.root),0)[0])

    def test_gate_status_snapshot_tampering_cannot_pass(self):
        self.check()
        snapshot=json.loads((self.root/(self.prefix+'/status.json')).read_text())
        snapshot['head_sha']=self.base
        self.write(self.prefix+'/status.json',json.dumps(snapshot))
        self.assertFalse(campaign.gate_evidence(str(self.root),0)[0])

    def test_changed_or_missing_stderr_invalidates_completed_attempt(self):
        self.check()
        stderr=self.root/(self.prefix+'/stderr.log')
        stderr.write_text('modified warning evidence\n')
        self.assertFalse(campaign.gate_evidence(str(self.root),0)[0])
        stderr.unlink()
        self.assertFalse(campaign.gate_evidence(str(self.root),0)[0])

    def test_blocked_phase_position_must_match_completed_history(self):
        self.finish()
        blocker={'code':'fixture','detail':'fixture','evidence':'fixture','unblock':'fixture','resume_state':'DO'}
        self.st.update(phase_state='BLOCKED',blocker=blocker); self.save()
        result=campaign.validate(str(self.root))
        self.assertFalse(result['ok'])
        self.assertTrue(any('inconsistent with last_completed_phase' in x for x in result['errors']))

    def test_active_gate_prevents_retry_and_cleanup(self):
        self.freeze()
        attempt=campaign.prepare_gate(str(self.root),0)
        process=subprocess.Popen([sys.executable,'-c','import sys; sys.stdin.read()'],cwd=attempt['checkout'],stdin=subprocess.PIPE)
        try:
            with self.assertRaisesRegex(ValueError,'still active'):
                campaign.prepare_gate(str(self.root),0)
            with self.assertRaisesRegex(ValueError,'still active'):
                campaign.cleanup_gate(str(self.root),0,attempt['attempt_id'])
        finally:
            process.terminate(); process.wait(); process.stdin.close()
        campaign.cleanup_gate(str(self.root),0,attempt['attempt_id'])

    def test_missing_criterion_and_launch_receipt_rejected(self):
        self.check(); self.report()
        p=self.root/'docs/refactor/reviews/phase-0-round-1.md'
        p.write_text('\n'.join(x for x in p.read_text().splitlines() if 'P00-06' not in x)+'\n')
        self.assertTrue(any('P00-06' in e for e in campaign.linked_evidence(str(self.root),0,self.st)))
        (self.root/'docs/refactor/execution/phase-0-round-1-context.json').unlink()
        self.assertTrue(campaign.linked_evidence(str(self.root),0,self.st))

    def test_plan_modified_after_candidate_rejected(self):
        self.check(); self.report()
        self.write('docs/refactor/execution/phase-0-plan.md','changed plan\n')
        self.st['frozen_plan_sha256']=campaign.sha256(str(self.root/'docs/refactor/execution/phase-0-plan.md'))
        self.assertTrue(any("candidate's frozen plan" in e for e in campaign.linked_evidence(str(self.root),0,self.st)))

    def test_blocker_requires_resume_state(self):
        self.st.update(phase_state='BLOCKED',blocker={'code':'fixture','detail':'fixture','evidence':'fixture','unblock':'fixture'})
        self.save(); self.assertFalse(campaign.validate(str(self.root))['ok'])
        self.st['blocker']['resume_state']='PLAN'
        self.save(); self.assertTrue(campaign.validate(str(self.root))['ok'])

    def test_historical_checkpoint_remains_proven_after_next_phase_edits(self):
        self.check(); self.report(); self.act(); self.st.update(phase_state='PASS',last_completed_phase=0)
        self.save(); self.commit('Record fixture PASS')
        self.write('packages/client/source.ts','later phase source\n'); self.commit('Later fixture phase')
        self.assertTrue(campaign.phase_proven(str(self.root),0)[0])

    def test_collector_records_real_nonzero_exit_despite_pass_stdout(self):
        self.freeze()
        fake = '#!/usr/bin/env python3\nimport subprocess,json,sys\nhead=subprocess.check_output(["git","rev-parse","HEAD"],text=True).strip()\nprint(json.dumps({"phase":0,"result":"PASS","head":head}))\nprint("ELEF_PHASE_0=PASS")\nsys.exit(9)\n'
        self.write('bin/check',fake); (self.root/'bin/check').chmod(0o755)
        self.commit('Add synthetic failing checker')
        self.assertEqual(campaign.run_gate(str(self.root),0),9)
        stored=json.loads((self.root/'docs/refactor/execution/phase-0-gate.json').read_text())
        self.assertEqual(stored['exit'],9)
        self.assertEqual(stored['head'],self.git('rev-parse','HEAD'))
        self.assertFalse(campaign.gate_evidence(str(self.root),0)[0])

    def test_duplicate_criterion_and_empty_evidence_rejected(self):
        self.check(); self.report()
        p=self.root/'docs/refactor/reviews/phase-0-round-1.md'
        p.write_text(p.read_text()+'| P00-01 | PASS | duplicate | | |\n')
        self.assertTrue(any('P00-01' in e for e in campaign.linked_evidence(str(self.root),0,self.st)))
        p.write_text(p.read_text().replace('| P00-02 | PASS | synthetic parser fixture |','| P00-02 | PASS | |'))
        self.assertTrue(any('P00-02' in e for e in campaign.linked_evidence(str(self.root),0,self.st)))

    def test_committed_check_act_pass_is_proven(self):
        self.finish()
        self.assertTrue(campaign.validate(str(self.root))['ok'])
        self.assertEqual(campaign.reconstruct(str(self.root))['earliest_unproven_phase'],1)

    def test_uncommitted_freeze_is_only_prospective(self):
        self.write('docs/refactor/execution/phase-0-plan.md','pending freeze\n')
        self.st.update(phase_state='DO',frozen_plan_sha256=campaign.sha256(str(self.root/'docs/refactor/execution/phase-0-plan.md')))
        self.save()
        self.assertFalse(campaign.validate(str(self.root))['ok'])
        self.assertTrue(campaign.validate(str(self.root),prospective=True)['ok'])
        self.write('packages/client/source.ts','production before freeze\n')
        self.assertFalse(campaign.validate(str(self.root),prospective=True)['ok'])
        self.commit('Invalid freeze with production changes')
        self.assertFalse(campaign.validate(str(self.root))['ok'])

    def test_plan_note_cannot_move_replan_boundary(self):
        self.freeze(); self.st.update(phase_state='PLAN',frozen_plan_sha256=None)
        self.save(); self.commit('Enter fixture re-plan')
        self.write('packages/client/source.ts','unplanned production\n')
        self.commit('Invalid change during PLAN')
        self.st['next_action']='Another planning note'; self.save(); self.commit('Record PLAN note')
        self.assertFalse(campaign.validate(str(self.root))['ok'])

    def test_blocked_candidate_guard_is_preserved(self):
        self.check()
        self.st.update(phase_state='BLOCKED',blocker={'code':'fixture','detail':'fixture','evidence':'fixture','unblock':'fixture','resume_state':'CHECK'})
        self.save(); self.commit('Block fixture review')
        self.assertTrue(campaign.validate(str(self.root))['ok'])
        self.write('packages/client/source.ts','changed while blocked\n')
        self.assertFalse(campaign.validate(str(self.root))['ok'])

    def test_missing_and_duplicate_contract_inventory_fails(self):
        phase=self.root/'docs/refactor/phases/01-foundations.md'; original=phase.read_bytes(); phase.unlink()
        self.assertFalse(campaign.reconstruct(str(self.root))['ok'])
        self.assertFalse(campaign.validate(str(self.root))['ok'])
        phase.write_bytes(original)
        self.write('docs/refactor/phases/00-duplicate.md','duplicate')
        self.assertFalse(campaign.reconstruct(str(self.root))['ok'])

    def test_phase_base_must_equal_predecessor_pass_checkpoint(self):
        checkpoint=self.finish()
        self.st.update(current_phase=1,phase_state='PLAN',phase_base_sha=self.base,head_sha=checkpoint,review_round=0,frozen_plan_sha256=None,phase_contract_sha256=campaign.sha256(str(self.root/'docs/refactor/phases/01-foundations.md')))
        self.save()
        self.assertFalse(campaign.validate(str(self.root))['ok'])
        self.st['phase_base_sha']=checkpoint; self.save()
        self.assertTrue(campaign.validate(str(self.root))['ok'])

    def test_untracked_mjs_and_configuration_are_detected(self):
        for path in ('script/new-check.mjs','build.mjs','settings.json'):
            self.write(path,'untracked input\n')
        paths=campaign.working_paths(str(self.root))
        self.assertTrue({'script/new-check.mjs','build.mjs','settings.json'}.issubset(paths))
        self.assertFalse(campaign.validate(str(self.root))['ok'])

    def test_gate_attempt_isolated_and_retry_preserves_logs(self):
        self.freeze()
        fake = '#!/usr/bin/env python3\nimport subprocess,json,os\nfrom pathlib import Path\nassert not Path("owner-input.json").exists()\nhead=subprocess.check_output(["git","rev-parse","HEAD"],text=True).strip()\nsnapshot=json.loads(Path(os.environ["ELEF_GATE_STATUS_PATH"]).read_text())\nassert snapshot["head_sha"]==head and snapshot["phase_state"]=="DO"\nassert json.loads(Path("docs/refactor/status.json").read_text())["head_sha"]!=head\nprint(json.dumps({"phase":0,"result":"PASS","head":head}))\nprint("ELEF_PHASE_0=PASS")\n'
        self.write('bin/check',fake); (self.root/'bin/check').chmod(0o755)
        self.commit('Add isolated fixture checker')
        self.write('owner-input.json','root-only owner data')
        first=campaign.prepare_gate(str(self.root),0)
        self.assertEqual(campaign.run_gate(str(self.root),0,first['attempt_id']),0)
        second=campaign.prepare_gate(str(self.root),0)
        self.assertEqual(campaign.run_gate(str(self.root),0,second['attempt_id']),0)
        for attempt in (first,second):
            directory=self.root/f"docs/refactor/execution/phase-0-gate-attempts/{attempt['attempt_id']}"
            self.assertTrue((directory/'stdout.txt').exists()); self.assertTrue((directory/'result.json').exists())
            campaign.cleanup_gate(str(self.root),0,attempt['attempt_id'])
        self.assertNotEqual(first['attempt_id'],second['attempt_id'])
        with self.assertRaises(ValueError): campaign.run_gate(str(self.root),0,first['attempt_id'])

    def test_socket_probe_permission_denial_is_unknown(self):
        from unittest.mock import patch
        with patch.object(campaign.socket,'socket',side_effect=PermissionError('fixture sandbox')):
            self.assertIsNone(campaign._port_open(3000))

    def test_bundle_prepare_is_repeatable_cleanup_preserves_dirty_worktree(self):
        self.check()
        source_skills=HERE.parents[1]
        target=self.root/'.agents/skills'
        shutil.copytree(source_skills,target)
        # Adding fixture tooling to candidate would invalidate it; ignored private test tools are enough.
        self.write('.git/info/exclude','.agents/\n')
        script=target/'independent-phase-review/scripts/review_bundle.py'
        def run(command):
            return subprocess.run(['python3',str(script),command,'0','1'],cwd=self.root,capture_output=True,text=True)
        a=run('prepare'); self.assertEqual(a.returncode,0,a.stderr)
        self.st['next_action']='Updated review monitoring action'; self.save(); self.commit('Update mutable CHECK note')
        b=run('prepare'); self.assertEqual(b.returncode,0,b.stderr)
        worktree=self.root/'tmp/reviews/phase-0-round-1/worktree'
        source=worktree/'packages/client/source.ts'
        source.write_text('unexpected reviewer change\n')
        failed=run('cleanup'); self.assertNotEqual(failed.returncode,0)
        self.assertTrue(source.exists())
        subprocess.run(['git','-C',str(worktree),'restore','packages/client/source.ts'],check=True)
        unknown=worktree/'unknown.txt'; unknown.write_text('fixture-owned unknown file')
        self.assertNotEqual(run('cleanup').returncode,0)
        self.assertTrue(unknown.exists()); unknown.unlink()
        clean=run('cleanup'); self.assertEqual(clean.returncode,0,clean.stderr)
        self.assertFalse(worktree.exists())
        again=run('cleanup'); self.assertEqual(again.returncode,0,again.stderr)

    def test_review_cleanup_refuses_active_process_and_nonterminal_session(self):
        self.check()
        target=self.root/'.agents/skills'
        shutil.copytree(SOURCE/'.agents/skills',target)
        self.write('.git/info/exclude','.agents/\n')
        script=target/'independent-phase-review/scripts/review_bundle.py'
        def run(command):
            return subprocess.run([sys.executable,str(script),command,'0','1'],cwd=self.root,capture_output=True,text=True)
        prepared=run('prepare'); self.assertEqual(prepared.returncode,0,prepared.stderr)
        worktree=self.root/'tmp/reviews/phase-0-round-1/worktree'
        process=subprocess.Popen([sys.executable,'-c','import sys; sys.stdin.read()'],cwd=worktree,stdin=subprocess.PIPE)
        try:
            blocked=run('cleanup'); self.assertNotEqual(blocked.returncode,0)
            self.assertIn('still in use',blocked.stderr)
        finally:
            process.terminate(); process.wait(); process.stdin.close()
        receipt='docs/refactor/execution/phase-0-round-1-context.json'
        self.write(receipt,json.dumps({'state':'running','identity':'synthetic-native-session'}))
        self.assertNotEqual(run('cleanup').returncode,0)
        self.write(receipt,json.dumps({'state':'interrupted','identity':'synthetic-native-session','terminal_evidence':'synthetic confirmed terminal tool response'}))
        cleaned=run('cleanup'); self.assertEqual(cleaned.returncode,0,cleaned.stderr)


if __name__=='__main__':
    unittest.main(verbosity=2)
