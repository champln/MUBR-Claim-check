"""
API router: Claim Batches & Records
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from auth import get_current_user, require_roles
from database import get_db
from models import ClaimBatch, ClaimRecord, PreScreenError, BatchStatus, ClaimStatus, User, UserRole
from schemas import BatchOut, ClaimRecordOut, MessageResponse

router = APIRouter(prefix="/batches", tags=["Batches"])


@router.get("/", response_model=list[BatchOut])
def list_batches(
    skip: int = 0,
    limit: int = 50,
    claim_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(ClaimBatch)
    if claim_type:
        q = q.filter(ClaimBatch.claim_type == claim_type)
    return q.order_by(ClaimBatch.created_at.desc()).offset(skip).limit(limit).all()


@router.get("/{batch_id}", response_model=BatchOut)
def get_batch(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    batch = db.query(ClaimBatch).filter(ClaimBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(404, "Batch not found")
    return batch


@router.delete("/{batch_id}", response_model=MessageResponse)
def delete_batch(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    batch = db.query(ClaimBatch).filter(ClaimBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(404, "Batch not found")
    db.delete(batch)
    db.commit()
    return {"message": f"Batch {batch_id} deleted"}


@router.get("/{batch_id}/claims", response_model=list[ClaimRecordOut])
def list_claims(
    batch_id: int,
    skip: int = 0,
    limit: int = 100,
    status: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(ClaimRecord).filter(ClaimRecord.batch_id == batch_id)
    if status:
        q = q.filter(ClaimRecord.status == status)
    if search:
        q = q.filter(
            (ClaimRecord.hn.contains(search))
            | (ClaimRecord.pid.contains(search))
            | (ClaimRecord.patient_name.contains(search))
        )
    return q.offset(skip).limit(limit).all()


@router.get("/{batch_id}/claims/{claim_id}", response_model=ClaimRecordOut)
def get_claim(
    batch_id: int,
    claim_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    claim = (
        db.query(ClaimRecord)
        .filter(ClaimRecord.id == claim_id, ClaimRecord.batch_id == batch_id)
        .first()
    )
    if not claim:
        raise HTTPException(404, "Claim not found")
    return claim
