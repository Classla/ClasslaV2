import { Router, Request, Response } from "express";
import { supabase } from "../middleware/auth";
import { authenticateToken } from "../middleware/auth";
import {
  requireOrganizationMembership,
  requireOrganizationAdmin,
  requireOrganizationPermission,
  getUserOrganizationRole,
  isOrganizationAdmin,
  isOrganizationMember,
  getOrganizationPermissions,
} from "../middleware/authorization";
import { OrganizationRole } from "../types/enums";
import { Organization, OrganizationMembership } from "../types/entities";

const router = Router();

/**
 * Generate a unique 6-character alphanumeric join code for organizations
 */
async function generateUniqueJoinCode(): Promise<string> {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    let joinCode = "";
    for (let i = 0; i < 6; i++) {
      joinCode += characters.charAt(
        Math.floor(Math.random() * characters.length)
      );
    }

    // Check if this join code already exists
    const { data: existingOrg } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", joinCode)
      .single();

    if (!existingOrg) {
      return joinCode;
    }

    attempts++;
  }

  throw new Error("Unable to generate unique join code after maximum attempts");
}

/**
 * POST /organization
 * Create organization (generates unique slug/join code)
 */
router.post(
  "/organization",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { name } = req.body;
      const { id: userId } = req.user!;

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({
          error: {
            code: "INVALID_NAME",
            message: "Organization name is required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Generate unique join code
      const slug = await generateUniqueJoinCode();

      // Create organization
      const { data: organization, error: orgError } = await supabase
        .from("organizations")
        .insert({
          name: name.trim(),
          slug: slug,
          created_by_id: userId,
        })
        .select()
        .single();

      if (orgError || !organization) {
        console.error("Error creating organization:", orgError);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create organization",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Add creator as admin
      const { error: membershipError } = await supabase
        .from("organization_memberships")
        .insert({
          organization_id: organization.id,
          user_id: userId,
          role: OrganizationRole.ADMIN,
        });

      if (membershipError) {
        console.error("Error creating membership:", membershipError);
        // Try to clean up organization
        await supabase.from("organizations").delete().eq("id", organization.id);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create organization membership",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.status(201).json(organization);
    } catch (error) {
      console.error("Error creating organization:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create organization",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /organization/:id
 * Get organization by ID
 */
router.get(
  "/organization/:id",
  authenticateToken,
  requireOrganizationMembership("id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const { data: organization, error } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !organization) {
        res.status(404).json({
          error: {
            code: "ORGANIZATION_NOT_FOUND",
            message: "Organization not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.json(organization);
    } catch (error) {
      console.error("Error retrieving organization:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve organization",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /organization/by-slug/:slug
 * Get organization by slug
 */
router.get(
  "/organization/by-slug/:slug",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { slug } = req.params;
      const { id: userId } = req.user!;

      const { data: organization, error } = await supabase
        .from("organizations")
        .select("*")
        .eq("slug", slug.toUpperCase())
        .single();

      if (error || !organization) {
        res.status(404).json({
          error: {
            code: "ORGANIZATION_NOT_FOUND",
            message: "Organization not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if user is a member (for access control)
      const isMember = await isOrganizationMember(userId, organization.id);
      if (!isMember) {
        res.status(403).json({
          error: {
            code: "NOT_ORGANIZATION_MEMBER",
            message: "Not authorized to access this organization",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.json(organization);
    } catch (error) {
      console.error("Error retrieving organization by slug:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve organization",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /organization/:id
 * Update organization (admin only)
 */
router.put(
  "/organization/:id",
  authenticateToken,
  requireOrganizationAdmin("id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { name } = req.body;

      // Check if organization exists
      const { data: existingOrg, error: existingError } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", id)
        .single();

      if (existingError || !existingOrg) {
        res.status(404).json({
          error: {
            code: "ORGANIZATION_NOT_FOUND",
            message: "Organization not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Prepare update data
      const updateData: Partial<Organization> = {};
      if (name !== undefined) {
        if (typeof name !== "string" || name.trim().length === 0) {
          res.status(400).json({
            error: {
              code: "INVALID_NAME",
              message: "Organization name must be a non-empty string",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
        updateData.name = name.trim();
      }

      if (Object.keys(updateData).length === 0) {
        res.status(400).json({
          error: {
            code: "NO_UPDATES",
            message: "No valid fields to update",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Update organization
      const { data: updatedOrg, error: updateError } = await supabase
        .from("organizations")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (updateError || !updatedOrg) {
        console.error("Error updating organization:", updateError);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update organization",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.json(updatedOrg);
    } catch (error) {
      console.error("Error updating organization:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update organization",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * DELETE /organization/:id
 * Delete organization (admin only)
 */
router.delete(
  "/organization/:id",
  authenticateToken,
  requireOrganizationAdmin("id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // Check if organization exists
      const { data: existingOrg, error: existingError } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", id)
        .single();

      if (existingError || !existingOrg) {
        res.status(404).json({
          error: {
            code: "ORGANIZATION_NOT_FOUND",
            message: "Organization not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Delete organization (cascade will handle memberships and templates)
      const { error: deleteError } = await supabase
        .from("organizations")
        .delete()
        .eq("id", id);

      if (deleteError) {
        console.error("Error deleting organization:", deleteError);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to delete organization",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting organization:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete organization",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /organization/join
 * Join organization by slug
 */
router.post(
  "/organization/join",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { slug } = req.body;
      const { id: userId } = req.user!;

      if (!slug || typeof slug !== "string") {
        res.status(400).json({
          error: {
            code: "INVALID_SLUG",
            message: "Organization slug is required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Find organization by slug
      const { data: organization, error: orgError } = await supabase
        .from("organizations")
        .select("*")
        .eq("slug", slug.toUpperCase())
        .single();

      if (orgError || !organization) {
        res.status(404).json({
          error: {
            code: "ORGANIZATION_NOT_FOUND",
            message: "Organization not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if user is already a member
      const existingMembership = await getUserOrganizationRole(
        userId,
        organization.id
      );
      if (existingMembership) {
        res.status(400).json({
          error: {
            code: "ALREADY_MEMBER",
            message: "User is already a member of this organization",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Add user as member
      const { data: membership, error: membershipError } = await supabase
        .from("organization_memberships")
        .insert({
          organization_id: organization.id,
          user_id: userId,
          role: OrganizationRole.MEMBER,
        })
        .select()
        .single();

      if (membershipError || !membership) {
        console.error("Error joining organization:", membershipError);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to join organization",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.status(201).json({
        organization,
        membership,
      });
    } catch (error) {
      console.error("Error joining organization:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to join organization",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /organization/:id/members
 * Get organization members (members can view)
 */
router.get(
  "/organization/:id/members",
  authenticateToken,
  requireOrganizationMembership("id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const { data: members, error } = await supabase
        .from("organization_memberships")
        .select(
          `
          id,
          role,
          joined_at,
          users (
            id,
            first_name,
            last_name,
            email
          )
        `
        )
        .eq("organization_id", id)
        .order("joined_at", { ascending: true });

      if (error) {
        console.error("Error fetching members:", error);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to fetch organization members",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.json(members || []);
    } catch (error) {
      console.error("Error fetching organization members:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch organization members",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /organization/:id/members
 * Add member (admin only)
 */
router.post(
  "/organization/:id/members",
  authenticateToken,
  requireOrganizationAdmin("id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { user_id, role } = req.body;

      if (!user_id || typeof user_id !== "string") {
        res.status(400).json({
          error: {
            code: "INVALID_USER_ID",
            message: "User ID is required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate role
      const memberRole =
        role === OrganizationRole.ADMIN
          ? OrganizationRole.ADMIN
          : OrganizationRole.MEMBER;

      // Check if user exists
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("id")
        .eq("id", user_id)
        .single();

      if (userError || !user) {
        res.status(404).json({
          error: {
            code: "USER_NOT_FOUND",
            message: "User not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if user is already a member
      const existingRole = await getUserOrganizationRole(user_id, id);
      if (existingRole) {
        res.status(400).json({
          error: {
            code: "ALREADY_MEMBER",
            message: "User is already a member of this organization",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Add member
      const { data: membership, error: membershipError } = await supabase
        .from("organization_memberships")
        .insert({
          organization_id: id,
          user_id: user_id,
          role: memberRole,
        })
        .select()
        .single();

      if (membershipError || !membership) {
        console.error("Error adding member:", membershipError);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to add member",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.status(201).json(membership);
    } catch (error) {
      console.error("Error adding member:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to add member",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /organization/:id/members/:userId
 * Update member role (admin only, can promote to admin)
 */
router.put(
  "/organization/:id/members/:userId",
  authenticateToken,
  requireOrganizationAdmin("id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id, userId } = req.params;
      const { role } = req.body;

      if (!role || (role !== OrganizationRole.ADMIN && role !== OrganizationRole.MEMBER)) {
        res.status(400).json({
          error: {
            code: "INVALID_ROLE",
            message: "Valid role (admin or member) is required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if membership exists
      const { data: existingMembership, error: existingError } = await supabase
        .from("organization_memberships")
        .select("*")
        .eq("organization_id", id)
        .eq("user_id", userId)
        .single();

      if (existingError || !existingMembership) {
        res.status(404).json({
          error: {
            code: "MEMBERSHIP_NOT_FOUND",
            message: "Membership not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Update role
      const { data: updatedMembership, error: updateError } = await supabase
        .from("organization_memberships")
        .update({ role: role as OrganizationRole })
        .eq("organization_id", id)
        .eq("user_id", userId)
        .select()
        .single();

      if (updateError || !updatedMembership) {
        console.error("Error updating membership:", updateError);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update membership",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.json(updatedMembership);
    } catch (error) {
      console.error("Error updating membership:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update membership",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * DELETE /organization/:id/members/:userId
 * Remove member (admin only)
 */
router.delete(
  "/organization/:id/members/:userId",
  authenticateToken,
  requireOrganizationAdmin("id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id, userId } = req.params;

      // Check if membership exists
      const { data: existingMembership, error: existingError } = await supabase
        .from("organization_memberships")
        .select("*")
        .eq("organization_id", id)
        .eq("user_id", userId)
        .single();

      if (existingError || !existingMembership) {
        res.status(404).json({
          error: {
            code: "MEMBERSHIP_NOT_FOUND",
            message: "Membership not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Delete membership
      const { error: deleteError } = await supabase
        .from("organization_memberships")
        .delete()
        .eq("organization_id", id)
        .eq("user_id", userId);

      if (deleteError) {
        console.error("Error removing member:", deleteError);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to remove member",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error removing member:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove member",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /organizations
 * Get user's organizations
 */
router.get(
  "/organizations",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id: userId } = req.user!;

      const { data: memberships, error } = await supabase
        .from("organization_memberships")
        .select(
          `
          id,
          role,
          joined_at,
          organizations (
            id,
            name,
            slug,
            created_by_id,
            created_at,
            updated_at
          )
        `
        )
        .eq("user_id", userId)
        .order("joined_at", { ascending: false });

      if (error) {
        console.error("Error fetching user organizations:", error);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to fetch organizations",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.json(memberships || []);
    } catch (error) {
      console.error("Error fetching user organizations:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch organizations",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

export default router;
