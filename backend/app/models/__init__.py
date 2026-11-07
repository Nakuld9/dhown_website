"""Model registry.

Importing this package registers every ORM model on ``Base.metadata`` so that
``Base.metadata.create_all`` and Alembic autogeneration see the full schema.
"""
from app.models.base import Base  # noqa: F401
from app.models.core import (  # noqa: F401
    Branch,
    Company,
    Department,
    Employee,
    Permission,
    Role,
    User,
    role_permissions,
    user_roles,
)
from app.models.masters import (  # noqa: F401
    BankAccount,
    Chemical,
    ChemicalCategory,
    ChemicalLot,
    CostCentre,
    Customer,
    FabricType,
    Machine,
    PaymentTerm,
    Recipe,
    RecipeMaterial,
    RecipeVersion,
    ShadeCode,
    Supplier,
    TaxCode,
    UnitOfMeasure,
    Warehouse,
    YarnMaster,
)
from app.models.accounting import (  # noqa: F401
    AccountingPeriod,
    AccountType,
    ChartOfAccount,
    JournalLine,
    PostingRule,
    Voucher,
    VoucherStatus,
    VoucherType,
)
from app.models.audit import AuditLog, DocumentSequence  # noqa: F401

# Registering the guard activates the immutable-ledger Session listeners.
from app.core import ledger_guard  # noqa: E402,F401

__all__ = ["Base"]
